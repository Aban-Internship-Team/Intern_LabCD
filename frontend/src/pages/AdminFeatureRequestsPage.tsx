import { Navigate } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, ThumbsUp } from 'lucide-react'
import { featureRequestsApi } from '../api/endpoints'
import type {
  FeatureRequest,
  FeatureRequestListItem,
  FeatureRequestStatus,
} from '../api/types'
import { AdminPagination } from '../components/admin/AdminPagination'
import { StatusMessage } from '../components/StatusMessage'
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

type StatusFilter = FeatureRequestStatus | 'all'

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'under_review', label: 'Under review' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
]

const STATUS_OPTIONS: FeatureRequestStatus[] = [
  'submitted',
  'under_review',
  'planned',
  'in_progress',
  'completed',
  'rejected',
]

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

function truncate(text: string, max = 100): string {
  const cleaned = text.trim()
  if (cleaned.length <= max) return cleaned
  return `${cleaned.slice(0, max)}…`
}

export function AdminFeatureRequestsPage() {
  const { user: currentUser } = useAuth()
  const [rows, setRows] = useState<FeatureRequestListItem[]>([])
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selected, setSelected] = useState<FeatureRequest | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const loadList = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await featureRequestsApi.list({ status: statusFilter })
      setRows(list)
      setSelected((prev) => {
        if (!prev) return null
        return list.some((row) => row.id === prev.id) ? prev : null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load feature requests')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    if (!currentUser?.is_admin) return
    void loadList()
  }, [currentUser?.is_admin, loadList])

  const pagination = useClientPagination(rows, { resetKey: statusFilter })

  if (!currentUser?.is_admin) {
    return <Navigate to="/login" replace />
  }

  const openDetail = async (requestId: number) => {
    setError(null)
    try {
      const detail = await featureRequestsApi.get(requestId)
      setSelected(detail)
      setCommentDraft('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load request')
    }
  }

  const changeStatus = async (requestId: number, status: FeatureRequestStatus) => {
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const updated = await featureRequestsApi.updateStatus(requestId, status)
      setSelected(updated)
      setRows((prev) => {
        if (statusFilter !== 'all' && updated.status !== statusFilter) {
          return prev.filter((row) => row.id !== updated.id)
        }
        return prev.map((row) =>
          row.id === updated.id
            ? {
                ...row,
                status: updated.status,
                vote_count: updated.vote_count,
                updated_at: updated.updated_at,
                has_voted: updated.has_voted,
              }
            : row,
        )
      })
      setMessage(`Status updated to ${status.replaceAll('_', ' ')}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setSaving(false)
    }
  }

  const toggleVote = async () => {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      if (selected.has_voted) {
        await featureRequestsApi.unvote(selected.id)
      } else {
        await featureRequestsApi.vote(selected.id)
      }
      const refreshed = await featureRequestsApi.get(selected.id)
      setSelected(refreshed)
      setRows((prev) =>
        prev.map((row) =>
          row.id === refreshed.id
            ? {
                ...row,
                vote_count: refreshed.vote_count,
                has_voted: refreshed.has_voted,
              }
            : row,
        ),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update vote')
    } finally {
      setSaving(false)
    }
  }

  const addComment = async () => {
    if (!selected) return
    const text = commentDraft.trim()
    if (!text) return
    setSaving(true)
    setError(null)
    try {
      await featureRequestsApi.addComment(selected.id, { comment: text })
      const refreshed = await featureRequestsApi.get(selected.id)
      setSelected(refreshed)
      setCommentDraft('')
      setMessage('Comment added.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment')
    } finally {
      setSaving(false)
    }
  }

  const removeRequest = async (requestId: number) => {
    if (!window.confirm(`Delete feature request #${requestId}?`)) return
    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      await featureRequestsApi.remove(requestId)
      setRows((prev) => prev.filter((row) => row.id !== requestId))
      setSelected((prev) => (prev?.id === requestId ? null : prev))
      setMessage('Feature request deleted.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={pageSection}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={pageTitle}>Feature requests</h1>
          <p className={pageIntro}>
            Review user ideas, change status, and moderate votes or comments.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className={`${fieldInput} w-auto min-w-[10rem]`}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            aria-label="Filter by status"
          >
            {FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
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

      {error && <StatusMessage type="error" message={error} />}
      {message && <StatusMessage type="success" message={message} />}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <section className={cardPanel}>
          <p className="mb-3 text-sm text-muted-text">
            {rows.length} request{rows.length === 1 ? '' : 's'}
          </p>
          {loading ? (
            <p className="text-sm text-muted-text">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-text">No feature requests yet.</p>
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted-text">
                      <th className="px-2 py-2 font-medium">Title</th>
                      <th className="px-2 py-2 font-medium">User</th>
                      <th className="px-2 py-2 font-medium">Votes</th>
                      <th className="px-2 py-2 font-medium">Status</th>
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
                          <div className="font-medium">{row.title}</div>
                          <div className="mt-1 text-xs text-muted-text">
                            {truncate(row.description)}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-foreground">{row.user_email ?? '—'}</td>
                        <td className="px-2 py-2 text-foreground">{row.vote_count}</td>
                        <td className="px-2 py-2 capitalize text-foreground">
                          {String(row.status).replaceAll('_', ' ')}
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

        <section className={cardPanel}>
          {!selected ? (
            <p className="text-sm text-muted-text">Select a request to manage details.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="m-0 text-base font-semibold text-foreground">{selected.title}</h2>
                <p className="mt-1 text-xs text-muted-text">
                  #{selected.id} · {selected.user_email ?? 'User'} ·{' '}
                  {formatWhen(selected.created_at)}
                </p>
              </div>

              <p className="whitespace-pre-wrap text-sm text-foreground">{selected.description}</p>

              <label className={fieldLabel}>
                <span>Status</span>
                <select
                  className={fieldInput}
                  value={selected.status}
                  disabled={saving}
                  onChange={(event) =>
                    void changeStatus(selected.id, event.target.value as FeatureRequestStatus)
                  }
                >
                  {STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  disabled={saving}
                  onClick={() => void toggleVote()}
                >
                  <ThumbsUp className="size-3.5" />
                  {selected.has_voted ? 'Remove vote' : 'Vote'} ({selected.vote_count})
                </button>
                <button
                  type="button"
                  className={`${btnBase} ${btnCompact}`}
                  disabled={saving}
                  onClick={() => void removeRequest(selected.id)}
                >
                  Delete
                </button>
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold text-foreground">Comments</h3>
                <div className="mb-3 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-border bg-surface-muted p-3">
                  {(selected.comments ?? []).length === 0 ? (
                    <p className="text-sm text-muted-text">No comments yet.</p>
                  ) : (
                    (selected.comments ?? []).map((comment) => (
                      <div
                        key={comment.id}
                        className="rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm"
                      >
                        <div className="text-xs text-muted-text">
                          {comment.user_email ?? `User #${comment.user_id}`} ·{' '}
                          {formatWhen(comment.created_at)}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-foreground">
                          {comment.comment}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <label className={fieldLabel}>
                  <span>Add comment</span>
                  <textarea
                    className={`${fieldInput} min-h-[80px] resize-y`}
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    disabled={saving}
                    maxLength={8000}
                  />
                </label>
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={saving || !commentDraft.trim()}
                  onClick={() => void addComment()}
                >
                  Post comment
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
