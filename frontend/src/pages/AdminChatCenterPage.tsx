import { Navigate } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import type { ChatMessage, ChatSessionListItem } from '../api/types'
import { ChatThread } from '../components/ChatThread'
import { useAuth } from '../context/AuthContext'
import {
  btnBase,
  btnCompact,
  cardPanel,
  fieldInput,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

/** Temporary mock inbox until notification/unread APIs land (see docs/CHAT_CENTER_CONTRACT.md). */
const MOCK_SESSIONS: ChatSessionListItem[] = [
  {
    id: 101,
    user_id: 12,
    user_email: 'alex@example.com',
    agent_id: 1,
    agent_email: 'admin@example.com',
    status: 'active',
    created_at: '2026-08-18T09:00:00.000Z',
    closed_at: null,
    unread_count: 2,
    last_message_preview: 'The export button still returns 500.',
    last_message_at: '2026-08-18T10:12:00.000Z',
    peer_online: true,
  },
  {
    id: 102,
    user_id: 15,
    user_email: 'sam@example.com',
    agent_id: null,
    agent_email: null,
    status: 'open',
    created_at: '2026-08-18T08:30:00.000Z',
    closed_at: null,
    unread_count: 1,
    last_message_preview: 'Hi — need help with my plan upgrade.',
    last_message_at: '2026-08-18T08:31:00.000Z',
    peer_online: false,
  },
  {
    id: 103,
    user_id: 18,
    user_email: 'jordan@example.com',
    agent_id: 1,
    agent_email: 'admin@example.com',
    status: 'closed',
    created_at: '2026-08-17T14:00:00.000Z',
    closed_at: '2026-08-17T16:20:00.000Z',
    unread_count: 0,
    last_message_preview: 'All set, thanks!',
    last_message_at: '2026-08-17T16:18:00.000Z',
    peer_online: false,
  },
]

const MOCK_MESSAGES: Record<number, ChatMessage[]> = {
  101: [
    {
      id: 1,
      chat_session_id: 101,
      sender_id: 12,
      sender_email: 'alex@example.com',
      message: 'Hi, export fails on completed silo projects.',
      created_at: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 2,
      chat_session_id: 101,
      sender_id: 1,
      sender_email: 'admin@example.com',
      message: 'Thanks — looking into it now.',
      created_at: '2026-08-18T10:05:00.000Z',
    },
    {
      id: 3,
      chat_session_id: 101,
      sender_id: 12,
      sender_email: 'alex@example.com',
      message: 'The export button still returns 500.',
      created_at: '2026-08-18T10:12:00.000Z',
    },
  ],
  102: [
    {
      id: 4,
      chat_session_id: 102,
      sender_id: 15,
      sender_email: 'sam@example.com',
      message: 'Hi — need help with my plan upgrade.',
      created_at: '2026-08-18T08:31:00.000Z',
    },
  ],
  103: [
    {
      id: 5,
      chat_session_id: 103,
      sender_id: 18,
      sender_email: 'jordan@example.com',
      message: 'All set, thanks!',
      created_at: '2026-08-17T16:18:00.000Z',
    },
  ],
}

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

export function AdminChatCenterPage() {
  const { user: currentUser } = useAuth()
  const [sessions] = useState<ChatSessionListItem[]>(MOCK_SESSIONS)
  const [selectedId, setSelectedId] = useState<number | null>(MOCK_SESSIONS[0]?.id ?? null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [messagesByChat, setMessagesByChat] = useState(MOCK_MESSAGES)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter((row) => {
      const haystack = [
        row.user_email,
        row.agent_email,
        row.last_message_preview,
        row.status,
        String(row.id),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [query, sessions])

  if (!currentUser?.is_admin) {
    return <Navigate to="/login" replace />
  }

  const selected = sessions.find((row) => row.id === selectedId) ?? null
  const messages = selected ? (messagesByChat[selected.id] ?? []) : []
  const closed = selected?.status === 'closed'

  const sendMockReply = () => {
    if (!selected || closed) return
    const text = draft.trim()
    if (!text) return
    const next: ChatMessage = {
      id: Date.now(),
      chat_session_id: selected.id,
      sender_id: currentUser.id,
      sender_email: currentUser.email,
      message: text,
      created_at: new Date().toISOString(),
    }
    setMessagesByChat((prev) => ({
      ...prev,
      [selected.id]: [...(prev[selected.id] ?? []), next],
    }))
    setDraft('')
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Chat Center</h1>
          <p className={pageIntro}>
            Unified inbox for support chats. Mock data for now — live unread/notifications wire-up
            follows the Chat Center contract.
          </p>
        </div>
        <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-text" />
          <input
            className={`${fieldInput} pl-9`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations…"
            aria-label="Search conversations"
          />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <section className={`${cardPanel} flex min-h-[480px] flex-col p-0 overflow-hidden`}>
          <div className="border-b border-border px-4 py-3">
            <h2 className="m-0 text-sm font-semibold text-foreground">Conversations</h2>
            <p className="mt-1 text-xs text-muted-text">
              {filtered.length} thread{filtered.length === 1 ? '' : 's'}
            </p>
          </div>

          {filtered.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <MessageSquare className="size-8 text-muted-text" aria-hidden />
              <p className="m-0 text-sm font-medium text-foreground">No conversations</p>
              <p className="m-0 text-sm text-muted-text">
                {query
                  ? 'Try a different search term.'
                  : 'New support chats will appear here once the live API is connected.'}
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
                        <span className="truncate text-xs text-muted-text">
                          {truncate(row.last_message_preview)}
                        </span>
                        {unread > 0 && (
                          <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[0.65rem] font-semibold text-primary-foreground">
                            {unread}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-text">
                        <span className="capitalize">#{row.id} · {row.status}</span>
                        <span
                          className={`inline-flex items-center gap-1 ${
                            row.peer_online ? 'text-[var(--app-status-success-text)]' : ''
                          }`}
                        >
                          <span
                            className={`size-1.5 rounded-full ${
                              row.peer_online ? 'bg-[var(--app-status-success-text)]' : 'bg-muted-text'
                            }`}
                            aria-hidden
                          />
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
              <p className="m-0 text-sm text-muted-text">
                Choose a thread on the left to read messages and reply.
              </p>
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
                <button type="button" className={`${btnBase} ${btnCompact}`} disabled>
                  Mark read (API soon)
                </button>
              </div>
              <ChatThread
                messages={messages}
                currentUserId={currentUser.id}
                draft={draft}
                onDraftChange={setDraft}
                onSend={sendMockReply}
                disabled={closed}
                sending={false}
                emptyLabel="No messages in this conversation yet."
              />
            </>
          )}
        </section>
      </div>
    </div>
  )
}
