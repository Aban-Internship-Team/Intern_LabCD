import { useEffect, useRef } from 'react'
import type { TicketMessage } from '../api/types'
import { btnPrimary, fieldInput } from '../lib/classes'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

interface TicketMessageThreadProps {
  messages: TicketMessage[]
  currentUserId: number | null
  draft: string
  onDraftChange: (value: string) => void
  onSend: () => void
  disabled?: boolean
  sending?: boolean
  emptyLabel?: string
}

export function TicketMessageThread({
  messages,
  currentUserId,
  draft,
  onDraftChange,
  onSend,
  disabled = false,
  sending = false,
  emptyLabel = 'No replies yet.',
}: TicketMessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface-muted p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-text">{emptyLabel}</p>
        ) : (
          messages.map((msg) => {
            const mine = currentUserId != null && msg.sender_id === currentUserId
            return (
              <div
                key={msg.id}
                className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                    mine
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border bg-surface-elevated text-foreground'
                  }`}
                >
                  <div
                    className={`mb-1 text-[0.7rem] ${
                      mine ? 'text-primary-foreground/80' : 'text-muted-text'
                    }`}
                  >
                    {msg.sender_email ?? `User #${msg.sender_id}`} · {formatWhen(msg.created_at)}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{msg.message}</div>
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="mt-3 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!disabled && !sending) onSend()
        }}
      >
        <input
          className={fieldInput}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={disabled ? 'Ticket is closed' : 'Write a reply…'}
          disabled={disabled || sending}
          maxLength={8000}
          aria-label="Ticket reply"
        />
        <button
          type="submit"
          className={btnPrimary}
          disabled={disabled || sending || !draft.trim()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
