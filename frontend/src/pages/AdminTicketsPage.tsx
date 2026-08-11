import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { ticketsApi } from '../api/endpoints'
import type {
  Ticket,
  TicketCategory,
  TicketListItem,
  TicketPriority,
  TicketStatus,
} from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { CreateTicketModal } from '../components/CreateTicketModal'
import { StatusMessage } from '../components/StatusMessage'
import { TicketMessageThread } from '../components/TicketMessageThread'
import { useAuth } from '../context/AuthContext'
import { useClientPagination } from '../hooks/useClientPagination'
import {
  btnBase,
  btnCompact,
  btnPrimary,
  cardPanel,
  fieldInput,
  fieldLabel,
  pageIntro,
  pageSection,
  pageTitle,
} from '../lib/classes'

type StatusFilter = TicketStatus | 'all'
type PriorityFilter = TicketPriority | 'all'
type CategoryFilter = TicketCategory | 'all'

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting_for_user', label: 'Waiting for user' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
]

const PRIORITY_FILTERS: { value: PriorityFilter; label: string }[] = [
  { value: 'all', label: 'All priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const CATEGORY_FILTERS: { value: CategoryFilter; label: string }[] = [
  { value: 'all', label: 'All categories' },
  { value: 'general', label: 'General' },
  { value: 'billing', label: 'Billing' },
  { value: 'technical', label: 'Technical' },
  { value: 'account', label: 'Account' },
  { value: 'other', label: 'Other' },
]

const STATUS_OPTIONS: TicketStatus[] = [
  'open',
  'in_progress',
  'waiting_for_user',
  'resolved',
  'closed',
]

function formatWhen(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function labelize(value: string): string {
  return value.replaceAll('_', ' ')
}

function truncate(text: string, max = 90): string {
  const cleaned = text.trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

function matchesFilters(
  ticket: TicketListItem | Ticket,
  statusFilter: StatusFilter,
  priorityFilter: PriorityFilter,
  categoryFilter: CategoryFilter,
): boolean {
  if (statusFilter !== 'all' && ticket.status !== statusFilter) return false
  if (priorityFilter !== 'all' && ticket.priority !== priorityFilter) return false
  if (categoryFilter !== 'all' && ticket.category !== categoryFilter) return false
  return true
}

export function AdminTicketsPage() {
  const { user: currentUser } = useAuth()
  const [rows, setRows] = useState<TicketListItem[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [draft, setDraft] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const filterKey = `${statusFilter}|${priorityFilter}|${categoryFilter}`

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await ticketsApi.list({
        status: statusFilter,
        priority: priorityFilter,
        category: categoryFilter,
      })
      setRows(list)
      setSelected((prev) => {
        if (!prev) return null
        return list.some((row) => row.id === prev.id) ? prev : null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tickets')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, priorityFilter, categoryFilter])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void loadList()
  }, [currentUser?.is_admin, loadList])

  const pagination = useClientPagination(rows, { resetKey: filterKey })

  if (!currentUser?.is_admin) {
    return <Navigate to="/login" replace />
  }

  const syncListRow = (ticket: Ticket) => {
    setRows((prev) => {
      const nextItem: TicketListItem = {
        id: ticket.id,
        user_id: ticket.user_id,
        user_email: ticket.user_email,
        assigned_to: ticket.assigned_to,
        assignee_email: ticket.assignee_email,
        title: ticket.title,
        description: ticket.description,
        category: ticket.category,
        priority: ticket.priority,
        status: ticket.status,
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        closed_at: ticket.closed_at,
      }
      if (!matchesFilters(nextItem, statusFilter, priorityFilter, categoryFilter)) {
        return prev.filter((row) => row.id !== ticket.id)
      }
      if (prev.some((row) => row.id === ticket.id)) {
        return prev.map((row) => (row.id === ticket.id ? nextItem : row))
      }
      return [nextItem, ...prev]
    })
  }

  const openDetail = async (ticketId: number) => {
    setError(null)
    try {
      const detail = await ticketsApi.get(ticketId)
      setSelected(detail)
      setDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ticket')
    }
  }

  const changeStatus = async (status: TicketStatus) => {
    if (!selected) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await ticketsApi.updateStatus(selected.id, status)
      setSelected(updated)
      syncListRow(updated)
      setMessage(`Status updated to ${labelize(status)}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setSaving(false)
    }
  }

  const assignToMe = async () => {
    if (!selected || !currentUser) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await ticketsApi.assign(selected.id, currentUser.id)
      setSelected(updated)
      syncListRow(updated)
      setMessage('Ticket assigned to you.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign ticket')
    } finally {
      setSaving(false)
    }
  }

  const unassign = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await ticketsApi.assign(selected.id, null)
      setSelected(updated)
      syncListRow(updated)
      setMessage('Assignee cleared.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unassign ticket')
    } finally {
      setSaving(false)
    }
  }

  const closeTicket = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await ticketsApi.close(selected.id)
      setSelected(updated)
      syncListRow(updated)
      setMessage(`Closed ticket #${updated.id}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close ticket')
    } finally {
      setSaving(false)
    }
  }

  const sendMessage = async () => {
    if (!selected || selected.status === 'closed') return
    const text = draft.trim()
    if (!text) return
    setSending(true)
    setError(null)
    try {
      const created = await ticketsApi.addMessage(selected.id, { message: text })
      const refreshed = await ticketsApi.get(selected.id)
      setSelected(refreshed)
      syncListRow(refreshed)
      setDraft('')
      if (!refreshed.messages?.some((item) => item.id === created.id)) {
        setSelected({
          ...refreshed,
          messages: [...(refreshed.messages ?? []), created],
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  const handleCreated = (ticket: Ticket) => {
    setMessage(`Ticket #${ticket.id} created.`)
    syncListRow(ticket)
    setSelected(ticket)
    setDraft('')
    void loadList()
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Tickets</h1>
          <p className={pageIntro}>
            Manage support tickets, assign owners, update status, and reply in-thread.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`${btnPrimary} ${btnCompact}`}
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-3.5" />
            New ticket
          </button>
          <button
            type="button"
            className={`${btnBase} ${btnCompact}`}
            onClick={() => void loadList()}
            disabled={loading}
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className={`${fieldInput} w-auto min-w-[10rem]`}
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          {STATUS_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className={`${fieldInput} w-auto min-w-[10rem]`}
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value as PriorityFilter)}
          aria-label="Filter by priority"
        >
          {PRIORITY_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <select
          className={`${fieldInput} w-auto min-w-[10rem]`}
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value as CategoryFilter)}
          aria-label="Filter by category"
        >
          {CATEGORY_FILTERS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className={cardPanel}>
          <p className="mb-3 text-sm text-muted-text">
            {rows.length} ticket{rows.length === 1 ? '' : 's'}
          </p>
          {loading ? (
            <p className="text-sm text-muted-text">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-text">No tickets match these filters.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-text">
                      <th className="px-2 py-2 font-medium">Ticket</th>
                      <th className="px-2 py-2 font-medium">User</th>
                      <th className="px-2 py-2 font-medium">Priority</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 font-medium">Assignee</th>
                      <th className="px-2 py-2 font-medium">Updated</th>
                      <th className="px-2 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagination.pageItems.map((row) => (
                      <tr
                        key={row.id}
                        className={`border-b border-border-subtle align-top ${
                          selected?.id === row.id ? 'bg-surface-muted' : ''
                        }`}
                      >
                        <td className="max-w-[220px] px-2 py-2 text-foreground">
                          <div className="font-medium">
                            #{row.id} · {row.title}
                          </div>
                          <div className="mt-1 text-xs capitalize text-muted-text">
                            {row.category} · {truncate(row.description)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-foreground">{row.user_email ?? '—'}</td>
                        <td className="px-2 py-2 capitalize text-foreground">{row.priority}</td>
                        <td className="px-2 py-2 capitalize text-foreground">
                          {labelize(String(row.status))}
                        </td>
                        <td className="px-2 py-2 text-foreground">
                          {row.assignee_email ?? '—'}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 text-muted-text">
                          {formatWhen(row.updated_at)}
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            className={`${btnBase} ${btnCompact}`}
                            onClick={() => void openDetail(row.id)}
                          >
                            View
                          </button>
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

        <section className={`${cardPanel} flex min-h-[480px] flex-col`}>
          {!selected ? (
            <p className="text-sm text-muted-text">Select a ticket to manage details and replies.</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div>
                <h2 className="m-0 text-base font-semibold text-foreground">
                  #{selected.id} · {selected.title}
                </h2>
                <p className="mt-1 text-xs text-muted-text">
                  {selected.user_email ?? 'User'} · {formatWhen(selected.created_at)}
                </p>
              </div>

              <p className="whitespace-pre-wrap text-sm text-foreground">{selected.description}</p>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className={fieldLabel}>
                  <span>Status</span>
                  <select
                    className={fieldInput}
                    value={selected.status}
                    disabled={saving}
                    onChange={(event) =>
                      void changeStatus(event.target.value as TicketStatus)
                    }
                  >
                    {STATUS_OPTIONS.map((status) => (
                      <option key={status} value={status}>
                        {labelize(status)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className={fieldLabel}>
                  <span>Assignee</span>
                  <div className="text-sm text-foreground">
                    {selected.assignee_email ?? 'Unassigned'}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${btnPrimary} ${btnCompact}`}
                  disabled={saving || selected.assigned_to === currentUser.id}
                  onClick={() => void assignToMe()}
                >
                  Assign to me
                </button>
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  disabled={saving || selected.assigned_to == null}
                  onClick={() => void unassign()}
                >
                  Unassign
                </button>
                {selected.status !== 'closed' && (
                  <button
                    type="button"
                    className={`${btnBase} ${btnCompact}`}
                    disabled={saving}
                    onClick={() => void closeTicket()}
                  >
                    Close
                  </button>
                )}
              </div>

              <div className="flex min-h-[240px] flex-1 flex-col">
                <h3 className="mb-2 text-sm font-semibold text-foreground">Conversation</h3>
                <TicketMessageThread
                  messages={selected.messages ?? []}
                  currentUserId={currentUser.id}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSend={() => void sendMessage()}
                  disabled={selected.status === 'closed'}
                  sending={sending}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      <CreateTicketModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
