import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { chatsApi } from '../api/endpoints'
import { ChatWebSocketClient, type ChatSocketEvent } from '../api/chatSocket'
import type { ChatMessage, ChatSession } from '../api/types'
import { useAuth } from '../context/AuthContext'
import { btnBase, btnCompact, btnPrimary, fieldInput } from '../lib/classes'
import { StatusMessage } from './StatusMessage'
import { ChatThread } from './ChatThread'

interface LiveChatWidgetProps {
  onClose: () => void
}

function upsertMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((item) => item.id === message.id)) return list
  return [...list, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
}

export function LiveChatWidget({ onClose }: LiveChatWidgetProps) {
  const { user } = useAuth()
  const [session, setSession] = useState<ChatSession | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [firstMessage, setFirstMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [onlineCount, setOnlineCount] = useState(0)
  const socketRef = useRef<ChatWebSocketClient | null>(null)

  const closed = session?.status === 'closed'

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
          return
        }
        if (event.type === 'presence') {
          setOnlineCount(event.online_count)
          return
        }
        if (event.type === 'status') {
          setSession((prev) =>
            prev && prev.id === event.id
              ? { ...prev, status: event.status, closed_at: event.closed_at ?? prev.closed_at }
              : prev,
          )
          return
        }
        if (event.type === 'error') {
          setError(event.detail)
        }
      },
    })
    socketRef.current = client
    client.connect()
  }, [])

  const loadActiveSession = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await chatsApi.list({ status: 'all' })
      const active =
        list.find((item) => item.status === 'open' || item.status === 'active') ?? null
      if (!active) {
        setSession(null)
        setMessages([])
        return
      }
      const detail = await chatsApi.get(active.id)
      setSession(detail)
      setMessages(detail.messages ?? [])
      if (detail.status !== 'closed') {
        attachSocket(detail.id)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chat')
    } finally {
      setLoading(false)
    }
  }, [attachSocket])

  useEffect(() => {
    void loadActiveSession()
    return () => {
      socketRef.current?.disconnect()
      socketRef.current = null
    }
  }, [loadActiveSession])

  const startSession = async () => {
    setStarting(true)
    setError(null)
    try {
      const created = await chatsApi.create({
        message: firstMessage.trim() || null,
      })
      setSession(created)
      setMessages(created.messages ?? [])
      setFirstMessage('')
      attachSocket(created.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat')
    } finally {
      setStarting(false)
    }
  }

  const sendMessage = async () => {
    if (!session || closed) return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const sentViaWs = socketRef.current?.sendMessage(text) ?? false
      if (!sentViaWs) {
        const message = await chatsApi.sendMessage(session.id, { message: text })
        setMessages((prev) => upsertMessage(prev, message))
      }
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const closeSession = async () => {
    if (!session) return
    setError(null)
    try {
      const updated = await chatsApi.close(session.id)
      setSession(updated)
      socketRef.current?.disconnect()
      setWsConnected(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close chat')
    }
  }

  return (
    <div className="fixed bottom-24 right-5 z-[55] flex w-[min(100vw-1.5rem,380px)] flex-col overflow-hidden rounded-2xl border border-border bg-surface-elevated shadow-2xl sm:bottom-28">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="m-0 text-base font-semibold text-foreground">Live support</h2>
          <p className="mt-1 text-xs text-muted-text">
            {session
              ? `Session #${session.id} · ${session.status}${
                  wsConnected ? ' · online' : ' · reconnecting'
                }${onlineCount > 0 ? ` · ${onlineCount} connected` : ''}`
              : 'Start a conversation with support'}
          </p>
        </div>
        <button
          type="button"
          className={`${btnBase} ${btnCompact}`}
          aria-label="Close chat widget"
          onClick={onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex max-h-[min(70vh,520px)] min-h-[320px] flex-col p-3">
        {error && <StatusMessage type="error" message={error} />}

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-text">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : !session ? (
          <div className="flex flex-1 flex-col">
            <label className="mb-3 flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-foreground">How can we help?</span>
              <textarea
                className={`${fieldInput} min-h-[100px] resize-y`}
                value={firstMessage}
                onChange={(event) => setFirstMessage(event.target.value)}
                placeholder="Optional first message"
                maxLength={8000}
                disabled={starting}
              />
            </label>
            <button
              type="button"
              className={btnPrimary}
              disabled={starting}
              onClick={() => void startSession()}
            >
              {starting ? 'Starting…' : 'Start chat'}
            </button>
          </div>
        ) : (
          <>
            <ChatThread
              messages={messages}
              currentUserId={user?.id ?? null}
              draft={draft}
              onDraftChange={setDraft}
              onSend={() => void sendMessage()}
              disabled={closed}
              sending={sending}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              {!closed && (
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  onClick={() => void closeSession()}
                >
                  End chat
                </button>
              )}
              {closed && (
                <button
                  type="button"
                  className={`${btnPrimary} ${btnCompact}`}
                  onClick={() => {
                    setSession(null)
                    setMessages([])
                    setDraft('')
                  }}
                >
                  New chat
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
