import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { chatsApi } from '../api/endpoints'
import { ChatWebSocketClient, type ChatSocketEvent } from '../api/chatSocket'
import type { ChatMessage, ChatSession, ChatSessionListItem } from '../api/types'
import { ChatThread } from '../components/ChatThread'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type StatusFilter = 'open' | 'active' | 'closed' | 'all'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'active', label: 'Active' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function upsertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

export function AdminLiveChatPage() {
  const { user: currentUser } = useAuth()
  const [sessions, setSessions] = useState<ChatSessionListItem[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
  const [selected, setSelected] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const socketRef = useRef<ChatWebSocketClient | null>(null)

  const attachSocket = useCallback((chatId: number) => {
    socketRef.current?.disconnect()
    const client = new ChatWebSocketClient(chatId, {
      onOpen: () => setWsConnected(true),
      onClose: () => setWsConnected(false),
      onError: () => setWsConnected(false),
      onEvent: (event: ChatSocketEvent) => {
        if (event.type === 'message') {
          const next: ChatMessage = {
            id: event.id,
            chat_session_id: event.chat_session_id,
            sender_id: event.sender_id,
            sender_email: event.sender_email,
            message: event.message,
            created_at: event.created_at,
          }
          setMessages((prev) => upsertMessage(prev, next))
        }
        if (event.type === 'status') {
          setSelected((prev) =>
            prev && prev.id === event.id
              ? { ...prev, status: event.status, closed_at: event.closed_at ?? prev.closed_at }
              : prev,
          )
          setSessions((prev) =>
            prev.map((row) =>
              row.id === event.id
                ? { ...row, status: event.status, closed_at: event.closed_at ?? row.closed_at }
                : row,
            ),
          )
        }
        if (event.type === 'error') {
          setError(event.detail)
        }
      },
    })
    socketRef.current = client
    client.connect()
  }, [])

  const loadSessions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await chatsApi.list({ status: statusFilter })
      setSessions(list)
      setSelected((prev) => {
        if (!prev) return null
        return list.some((row) => row.id === prev.id) ? prev : null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chats')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void loadSessions()
  }, [currentUser?.is_admin, loadSessions])

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [])

  const pagination = useClientPagination(sessions, { resetKey: statusFilter })

  if (!currentUser?.is_admin) {
    return <Navigate to="/login" replace />
  }

  const openSession = async (chatId: number) => {
    setError(null)
    setMessage(null)
    try {
      const detail = await chatsApi.get(chatId)
      setSelected(detail)
      setMessages(detail.messages ?? [])
      setDraft('')
      if (detail.status !== 'closed') {
        attachSocket(detail.id)
      } else {
        socketRef.current?.disconnect()
        setWsConnected(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open chat')
    }
  }

  const joinSession = async (chatId: number) => {
    setJoining(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await chatsApi.join(chatId)
      setSelected(updated)
      setMessages(updated.messages ?? [])
      setSessions((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                agent_id: updated.agent_id,
                agent_email: updated.agent_email,
                status: updated.status,
              }
            : row,
        ),
      )
      attachSocket(updated.id)
      setMessage(`Joined chat #${updated.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join chat')
    } finally {
      setJoining(false)
    }
  }

  const sendMessage = async () => {
    if (!selected || selected.status === 'closed') return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const sentViaWs = socketRef.current?.sendMessage(text) ?? false
      if (!sentViaWs) {
        const created = await chatsApi.sendMessage(selected.id, { message: text })
        setMessages((prev) => upsertMessage(prev, created))
      }
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const closeSession = async () => {
    if (!selected) return
    setError(null)
    try {
      const updated = await chatsApi.close(selected.id)
      setSelected(updated)
      setSessions((prev) =>
        prev.map((row) =>
          row.id === updated.id
            ? { ...row, status: updated.status, closed_at: updated.closed_at }
            : row,
        ),
      )
      socketRef.current?.disconnect()
      setWsConnected(false)
      setMessage(`Closed chat #${updated.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close chat')
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Live chat</h1>
          <p className={pageIntro}>
            Review support sessions, join open chats, and reply in real time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-xl border border-border bg-surface-muted p-1"
            role="group"
            aria-label="Filter by status"
          >
            {FILTERS.map((filter) => (
              <button
                key={filter.value}
                type="button"
                className={`${btnCompact} rounded-lg px-3 ${
                  statusFilter === filter.value
                    ? 'bg-surface-elevated text-foreground shadow-sm'
                    : 'bg-transparent text-muted-text hover:text-foreground'
                }`}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            onClick={() => void loadSessions()}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <section className={cardPanel}>
          <p className="mb-3 text-sm text-muted-text">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
            {statusFilter !== 'all' ? ` (${statusFilter})` : ''}
          </p>
          {loading ? (
            <p className="text-sm text-muted-text">Loading…</p>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-muted-text">No chat sessions.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-text">
                      <th className="px-2 py-2 font-medium">ID</th>
                      <th className="px-2 py-2 font-medium">User</th>
                      <th className="px-2 py-2 font-medium">Agent</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Created</th>
                      <th className="px-2 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.pageItems.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-border-subtle ${
                          selected?.id === row.id ? 'bg-surface-muted' : ''
                        }`}
                      >
                        <td className="px-2 py-2 text-foreground">#{row.id}</td>
                        <td className="px-2 py-2 text-foreground">{row.user_email ?? '—'}</td>
                        <td className="px-2 py-2 text-foreground">{row.agent_email ?? '—'}</td>
                        <td className="px-2 py-2 capitalize text-foreground">{row.status}</td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                          {formatWhen(row.created_at)}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`${btnBase} ${btnCompact}`}
                              onClick={() => void openSession(row.id)}
                            >
                              Open
                            </button>
                            {row.status !== 'closed' && (
                              <button
                                type="button"
                                className={`${btnPrimary} ${btnCompact}`}
                                disabled={joining}
                                onClick={() => void joinSession(row.id)}
                              >
                                Join
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <AdminPagination
                page={pagination.page}
                totalPages={pagination.totalPages}
                total={pagination.total}
                from={pagination.from}
                to={pagination.to}
                onPageChange={pagination.setPage}
              />
            </div>
          )}
        </section>

        <section className={`${cardPanel} flex min-h-[420px] flex-col`}>
          {!selected ? (
            <p className="text-sm text-muted-text">Select a session to view the conversation.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="m-0 text-base font-semibold text-foreground">
                    Chat #{selected.id}
                  </h2>
                  <p className="mt-1 text-xs text-muted-text">
                    {selected.user_email ?? 'User'} · {selected.status}
                    {wsConnected ? ' · live' : ''}
                  </p>
                </div>
                {selected.status !== 'closed' && (
                  <button
                    type="button"
                    className={`${btnBase} ${btnCompact}`}
                    onClick={() => void closeSession()}
                  >
                    Close
                  </button>
                )}
              </div>
              <ChatThread
                messages={messages}
                currentUserId={currentUser.id}
                draft={draft}
                onDraftChange={setDraft}
                onSend={() => void sendMessage()}
                disabled={selected.status === 'closed'}
                sending={sending}
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
