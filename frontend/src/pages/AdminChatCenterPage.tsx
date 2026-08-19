import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, RefreshCw, Search } from 'lucide-react'
import type { ChatMessage, ChatSessionListItem } from '../api/types'
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

function mergeMessage(rows: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (rows.some((item) => item.id === message.id)) {
    return rows.map((item) => (item.id === message.id ? message : item))
  }
  return [...rows, message].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export function AdminChatCenterPage() {
  const { user: currentUser } = useAuth()
  const { notifications } = useNotifications()
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [messagesByChat, setMessagesByChat] = useState<Record<number, ChatMessage[]>>({})
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedRef = useRef<number | null>(null)
  const lastChatNotificationIdRef = useRef<number | null>(null)

  const loadSessions = useCallback(async () => {
    try {
      const rows = await chatCenterApi.listChats()
      setSessions(rows)
      setSelectedId((current) => {
        if (current != null && rows.some((row) => row.id === current)) return current
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
    const latestChatNotification = notifications.find(
      (notification) => notification.type === 'chat_message' && notification.chat_id != null,
    )
    if (!latestChatNotification) return
    if (lastChatNotificationIdRef.current === latestChatNotification.id) return

    lastChatNotificationIdRef.current = latestChatNotification.id
    void loadSessions()
  }, [notifications, loadSessions])

  useEffect(() => {
    selectedRef.current = selectedId
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
  }, [selectedId])

  useEffect(() => {
    if (selectedId == null) return
    const url = chatCenterApi.chatWsUrl(selectedId)
    if (!url) return
    let socket: WebSocket | null = new WebSocket(url)
    let reconnectTimer: number | null = null
    let stopped = false

    const attachHandlers = (ws: WebSocket) => {
      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>
          if (payload.type === 'message') {
            const message: ChatMessage = {
              id: Number(payload.id),
              chat_session_id: Number(payload.chat_session_id),
              sender_id: Number(payload.sender_id),
              sender_email: (payload.sender_email as string | null) ?? null,
              message: String(payload.message ?? ''),
              created_at: String(payload.created_at ?? new Date().toISOString()),
            }
            setMessagesByChat((prev) => ({
              ...prev,
              [selectedId]: mergeMessage(prev[selectedId] ?? [], message),
            }))
            if (message.sender_id !== currentUser?.id) {
              void chatCenterApi.markChatRead(selectedId)
            }
            void loadSessions()
          } else if (payload.type === 'presence' || payload.type === 'status') {
            void loadSessions()
          }
        } catch {
          // Ignore malformed frames and keep the REST-loaded thread visible.
        }
      }
      ws.onclose = () => {
        if (!stopped) {
          reconnectTimer = window.setTimeout(() => {
            const nextUrl = chatCenterApi.chatWsUrl(selectedId)
            if (!nextUrl || stopped) return
            socket = new WebSocket(nextUrl)
            attachHandlers(socket)
          }, 1500)
        }
      }
      ws.onerror = () => ws.close()
    }

    attachHandlers(socket)
    return () => {
      stopped = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      socket?.close()
      socket = null
    }
  }, [selectedId, currentUser?.id, loadSessions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((row) =>
      [row.user_email, row.agent_email, row.last_message_preview, row.status, String(row.id)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, sessions])

  if (!currentUser?.is_admin) return <Navigate to="/login" replace />

  const selected = sessions.find((row) => row.id === selectedId) ?? null
  const messages = selected ? (messagesByChat[selected.id] ?? []) : []
  const closed = selected?.status === 'closed'

  const markSelectedRead = async () => {
    if (!selected) return
    try {
      await chatCenterApi.markChatRead(selected.id)
      setSessions((prev) =>
        prev.map((row) => (row.id === selected.id ? { ...row, unread_count: 0 } : row)),
      )
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
      setDraft('')
      await loadSessions()
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
                      onClick={() => {
                        setSelectedId(row.id)
                        setDraft('')
                      }}
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
