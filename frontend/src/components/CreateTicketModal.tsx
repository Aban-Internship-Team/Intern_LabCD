import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Ticket as TicketIcon } from 'lucide-react'
import { ticketsApi } from '../api/endpoints'
import type { Ticket, TicketCategory, TicketPriority } from '../api/types'
import { StatusMessage } from './StatusMessage'
import { btnBase, btnPrimary, btnWide, fieldInput, fieldLabel } from '../lib/classes'

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'billing', label: 'Billing' },
  { value: 'technical', label: 'Technical' },
  { value: 'account', label: 'Account' },
  { value: 'other', label: 'Other' },
]

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

interface CreateTicketModalProps {
  open: boolean
  onClose: () => void
  onCreated?: (ticket: Ticket) => void
}

export function CreateTicketModal({ open, onClose, onCreated }: CreateTicketModalProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<TicketCategory>('general')
  const [priority, setPriority] = useState<TicketPriority>('medium')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setDescription('')
    setCategory('general')
    setPriority('medium')
    setError(null)
    setSaving(false)
  }, [open])

  if (!open) return null

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !description.trim()) {
      setError('Title and description are required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await ticketsApi.create({
        title: title.trim(),
        description: description.trim(),
        category,
        priority,
      })
      onCreated?.(created)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        className="admin-fade-in absolute inset-0 bg-foreground/45 backdrop-blur-[2px]"
        aria-label="Close create ticket"
        onClick={onClose}
        disabled={saving}
      />
      <div
        className="admin-slide-in relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-surface-elevated p-4 shadow-2xl sm:p-6"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-ticket-title"
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface-muted text-foreground">
            <TicketIcon className="size-5" aria-hidden />
          </div>
          <div>
            <h2 id="create-ticket-title" className="m-0 text-xl font-semibold text-foreground">
              New support ticket
            </h2>
            <p className="mt-2 text-sm text-muted-text">
              Describe the issue. Support can reply and update status from the tickets board.
            </p>
          </div>
        </div>

        <form className="mt-5" onSubmit={(event) => void handleSubmit(event)}>
          <label className={fieldLabel}>
            <span>Title</span>
            <input
              className={fieldInput}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={300}
              required
              disabled={saving}
              placeholder="Short summary of the problem"
            />
          </label>

          <label className={fieldLabel}>
            <span>Description</span>
            <textarea
              className={`${fieldInput} min-h-[120px] resize-y`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={8000}
              required
              disabled={saving}
              placeholder="What happened? Steps to reproduce? Expected result?"
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className={fieldLabel}>
              <span>Category</span>
              <select
                className={fieldInput}
                value={category}
                onChange={(event) => setCategory(event.target.value as TicketCategory)}
                disabled={saving}
              >
                {CATEGORIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldLabel}>
              <span>Priority</span>
              <select
                className={fieldInput}
                value={priority}
                onChange={(event) => setPriority(event.target.value as TicketPriority)}
                disabled={saving}
              >
                {PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <StatusMessage type="error" message={error} />}

          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className={`${btnBase} ${btnWide} sm:mt-4`}
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className={`${btnPrimary} ${btnWide}`} disabled={saving}>
              {saving ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Creating…
                </span>
              ) : (
                'Create ticket'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
