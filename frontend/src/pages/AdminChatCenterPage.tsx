import { Navigate, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, RefreshCw, Search } from 'lucide-react'
import type { ChatMessage, ChatSessionListItem } from '../api/types'
import { ChatWebSocketClient, type ChatSocketEvent } from '../api/chatSocket'
import { chatCenterApi } from '../api/chatCenter'
import { ChatThread } from '../components/ChatThread'
import { useAuth } from '../context/AuthContext'
import { useNotifications } from '../context/NotificationContext'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function truncate(text: string | null | undefined, max = 56): string {
  const value = (text ?? '').trim()
  if (!value) return 'No messages yet'
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}

function messageTime(iso: string): number {
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? 0 : value
}

function mergeMessage(rows: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (rows.some((item) => item.id === message.id)) {
    return rows.map((item) => (item.id === message.id ? message : item))
  }
  return [...rows, message].sort((a, b) => messageTime(a.created_at) - messageTime(b.created_at))
}

function parseChatQuery(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function AdminChatCenterPage() {
  const { user: currentUser } = useAuth()
  const { notifications, setActiveChatId, markNotificationsForChatRead } = useNotifications()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedChatId = parseChatQuery(searchParams.get('chat'))
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(requestedChatId)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [messagesByChat, setMessagesByChat] = useState<Record<number, ChatMessage[]>>({})
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lastChatNotificationIdRef = useRef<number | null>(null)

  const selectChat = useCallback(
    (chatId: number | null) => {
      setSelectedId(chatId)
      setDraft('')
      if (chatId == null) {
        setSearchParams({}, { replace: true })
        return
      }
      setSearchParams({ chat: String(chatId) }, { replace: true })
    },
    [setSearchParams],
  )

  const loadSessions = useCallback(async () => {
    try {
      const rows = await chatCenterApi.listChats()
      setSessions(rows)
      setSelectedId((current) => {
        if (current != null && rows.some((row) => row.id === current)) return current
        const fromQuery = parseChatQuery(new URLSearchParams(window.location.search).get('chat'))
        if (fromQuery != null && rows.some((row) => row.id === fromQuery)) return fromQuery
        return rows[0]?.id ?? null
      })
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (currentUser?.is_admin) void loadSessions()
  }, [currentUser?.is_admin, loadSessions])

  useEffect(() => {
    if (requestedChatId == null) return
    if (sessions.some((row) => row.id === requestedChatId)) {
      setSelectedId(requestedChatId)
    }
  }, [requestedChatId, sessions])

  useEffect(() => {
    setActiveChatId(selectedId)
    return () => setActiveChatId(null)
  }, [selectedId, setActiveChatId])

  useEffect(() => {
    const latestChatNotification = notifications.find(
      (notification) => notification.type === 'chat_message' && notification.chat_id != null,
    )
    if (!latestChatNotification) return
    if (lastChatNotificationIdRef.current === latestChatNotification.id) return

    lastChatNotificationIdRef.current = latestChatNotification.id
    void loadSessions()
  }, [notifications, loadSessions])

  useEffect(() => {
    if (selectedId == null) return
    let cancelled = false
    setThreadLoading(true)
    Promise.all([
      chatCenterApi.listMessages(selectedId),
      chatCenterApi.markChatRead(selectedId).catch(() => null),
    ])
      .then(([messages]) => {
        if (cancelled) return
        setMessagesByChat((prev) => ({ ...prev, [selectedId]: messages }))
        setSessions((prev) =>
          prev.map((row) => (row.id === selectedId ? { ...row, unread_count: 0 } : row)),
        )
        markNotificationsForChatRead(selectedId)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load messages')
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedId, markNotificationsForChatRead])

  const selected = sessions.find((row) => row.id === selectedId) ?? null
  const selectedReady = selected != null
  const closed = selected?.status === 'closed'

  useEffect(() => {
    if (selectedId == null || !selectedReady || closed) return

    let stopped = false
    let reconnectTimer: number | null = null
    let client: ChatWebSocketClient | null = null

    const handleEvent = (event: ChatSocketEvent) => {
      if (event.type === 'message') {
        const message: ChatMessage = {
          id: event.id,
          chat_session_id: event.chat_session_id,
          sender_id: event.sender_id,
          sender_email: event.sender_email,
          message: event.message,
          created_at: event.created_at,
        }
        setMessagesByChat((prev) => ({
          ...prev,
          [selectedId]: mergeMessage(prev[selectedId] ?? [], message),
        }))
        setSessions((prev) =>
          prev.map((row) =>
            row.id === selectedId
              ? {
                  ...row,
                  last_message_preview: message.message,
                  last_message_at: message.created_at,
                  unread_count: message.sender_id === currentUser?.id ? row.unread_count : 0,
                }
              : row,
          ),
        )
        if (message.sender_id !== currentUser?.id) {
          void chatCenterApi.markChatRead(selectedId)
          markNotificationsForChatRead(selectedId)
        }
        return
      }

      if (event.type === 'presence') {
        setSessions((prev) =>
          prev.map((row) => {
            if (row.id !== event.chat_id) return row
            const peerId = currentUser?.id === row.user_id ? row.agent_id : row.user_id
            if (peerId !== event.user_id) return row
            return { ...row, peer_online: event.online }
          }),
        )
        return
      }

      if (event.type === 'status') {
        setSessions((prev) =>
          prev.map((row) =>
            row.id === event.id
              ? { ...row, status: event.status, closed_at: event.closed_at ?? row.closed_at }
              : row,
          ),
        )
      }
    }

    const connect = () => {
      if (stopped) return
      client = new ChatWebSocketClient(selectedId, {
        onEvent: handleEvent,
        onClose: (event) => {
          if (stopped) return
          if (event.code === 4401 || event.code === 4403 || event.code === 4409) return
          reconnectTimer = window.setTimeout(connect, 1500)
        },
      })
      client.connect()
    }

    connect()
    return () => {
      stopped = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      client?.disconnect()
    }
  }, [selectedId, selectedReady, closed, currentUser?.id, markNotificationsForChatRead])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...sessions].sort((a, b) => {
      const aTime = messageTime(a.last_message_at ?? a.created_at)
      const bTime = messageTime(b.last_message_at ?? b.created_at)
      return bTime - aTime
    })
    if (!q) return sorted
    return sorted.filter((row) =>
      [row.user_email, row.agent_email, row.last_message_preview, row.status, String(row.id)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, sessions])

  if (!currentUser?.is_admin) return <Navigate to="/login" replace />

  const messages = selected ? (messagesByChat[selected.id] ?? []) : []

  const markSelectedRead = async () => {
    if (!selected) return
    try {
      await chatCenterApi.markChatRead(selected.id)
      setSessions((prev) =>
        prev.map((row) => (row.id === selected.id ? { ...row, unread_count: 0 } : row)),
      )
      markNotificationsForChatRead(selected.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark conversation as read')
    }
  }

  const sendReply = async () => {
    if (!selected || closed || sending) return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    try {
      const message = await chatCenterApi.sendMessage(selected.id, text)
      setMessagesByChat((prev) => ({
        ...prev,
        [selected.id]: mergeMessage(prev[selected.id] ?? [], message),
      }))
      setSessions((prev) =>
        prev.map((row) =>
          row.id === selected.id
            ? {
                ...row,
                last_message_preview: message.message,
                last_message_at: message.created_at,
                status: row.status === 'open' ? 'active' : row.status,
                agent_id: row.agent_id ?? currentUser.id,
                agent_email: row.agent_email ?? currentUser.email,
              }
            : row,
        ),
      )
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Chat Center</h1>
          <p className={pageIntro}>Unified live inbox for support chats, unread state and presence.</p>
        </div>
        <div className="flex min-w-[260px] flex-1 items-center gap-2 sm:max-w-md">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-text" />
            <input
              className={`${fieldInput} pl-9`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search conversations…"
              aria-label="Search conversations"
            />
          </div>
          <button type="button" className={`${btnBase} ${btnCompact}`} onClick={() => void loadSessions()}>
            <RefreshCw className="size-4" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className={`${cardPanel} flex min-h-[480px] flex-col overflow-hidden p-0`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="m-0 text-sm font-semibold text-foreground">Conversations</h2>
            <p className="mt-1 text-xs text-muted-text">
              {loading ? 'Loading…' : `${filtered.length} thread${filtered.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {!loading && filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <MessageSquare className="size-8 text-muted-text" aria-hidden />
              <p className="m-0 text-sm font-medium text-foreground">No conversations</p>
              <p className="m-0 text-sm text-muted-text">
                {query ? 'Try a different search term.' : 'New support chats will appear here.'}
              </p>
            </div>
          ) : (
            <ul className="m-0 flex-1 list-none overflow-y-auto p-0">
              {filtered.map((row) => {
                const active = selectedId === row.id
                const unread = row.unread_count ?? 0
                return (
                  <li key={row.id} className="border-b border-border-subtle">
                    <button
                      type="button"
                      className={`flex w-full flex-col gap-1 px-4 py-3 text-left transition ${
                        active ? 'bg-surface-muted' : 'hover:bg-surface-hover'
                      }`}
                      onClick={() => selectChat(row.id)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {row.user_email ?? `User #${row.user_id}`}
                        </span>
                        <span className="shrink-0 text-[0.7rem] text-muted-text">
                          {formatWhen(row.last_message_at)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs text-muted-text">{truncate(row.last_message_preview)}</span>
                        {unread > 0 && (
                          <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary-foreground">
                            {unread}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-text">
                        <span className="capitalize">#{row.id} · {row.status}</span>
                        <span className={`inline-flex items-center gap-1 ${row.peer_online ? 'text-[var(--app-status-success-text)]' : ''}`}>
                          <span className={`size-1.5 rounded-full ${row.peer_online ? 'bg-[var(--app-status-success-text)]' : 'bg-muted-text'}`} aria-hidden />
                          {row.peer_online ? 'Online' : 'Offline'}
                        </span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className={`${cardPanel} flex min-h-[480px] flex-col`}>
          {!selected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <MessageSquare className="size-8 text-muted-text" aria-hidden />
              <p className="m-0 text-sm font-medium text-foreground">Select a conversation</p>
              <p className="m-0 text-sm text-muted-text">Choose a thread on the left to read messages and reply.</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
                <div>
                  <h2 className="m-0 text-base font-semibold text-foreground">
                    {selected.user_email ?? `User #${selected.user_id}`}
                  </h2>
                  <p className="mt-1 text-xs text-muted-text">
                    Chat #{selected.id} · {selected.status}
                    {selected.agent_email ? ` · Agent ${selected.agent_email}` : ' · Unassigned'}
                  </p>
                </div>
                <button type="button" className={`${btnBase} ${btnCompact}`} onClick={() => void markSelectedRead()} disabled={(selected.unread_count ?? 0) === 0}>
                  Mark read
                </button>
              </div>
              {threadLoading ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-text">Loading messages…</div>
              ) : (
                <ChatThread
                  messages={messages}
                  currentUserId={currentUser.id}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={sendReply}
                  disabled={closed}
                  sending={sending}
                  emptyLabel="No messages in this conversation yet."
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
