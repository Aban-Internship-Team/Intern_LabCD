import { useEffect, useRef, useState } from 'react'
import { Bell, Volume2, VolumeX } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useNotifications } from '../context/NotificationContext'
import { btnBase, btnCompact } from '../lib/classes'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    soundEnabled,
    setSoundEnabled,
    markRead,
    markAllRead,
  } = useNotifications()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const latest = notifications.slice(0, 8)

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`${btnBase} ${btnCompact} relative`}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((prev) => !prev)}
      >
        <Bell className="size-4" aria-hidden />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[0.65rem] font-semibold leading-none text-primary-foreground">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-[min(100vw-2rem,22rem)] overflow-hidden rounded-xl border border-border bg-surface-elevated shadow-xl"
          role="dialog"
          aria-label="Notification list"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
            <div>
              <div className="text-sm font-semibold text-foreground">Notifications</div>
              <div className="text-[0.7rem] text-muted-text">
                {unreadCount} unread
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                title={soundEnabled ? 'Mute notification sound' : 'Enable notification sound'}
                onClick={() => setSoundEnabled(!soundEnabled)}
              >
                {soundEnabled ? (
                  <Volume2 className="size-3.5" aria-hidden />
                ) : (
                  <VolumeX className="size-3.5" aria-hidden />
                )}
              </button>
              <button
                type="button"
                className={`${btnBase} ${btnCompact}`}
                disabled={unreadCount === 0}
                onClick={markAllRead}
              >
                Mark all
              </button>
            </div>
          </div>

          <ul className="m-0 max-h-80 list-none overflow-y-auto p-0">
            {latest.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-muted-text">No notifications yet.</li>
            ) : (
              latest.map((item) => (
                <li key={item.id} className="border-b border-border-subtle last:border-b-0">
                  <button
                    type="button"
                    className={`flex w-full flex-col gap-1 px-3 py-2.5 text-left transition hover:bg-surface-hover ${
                      item.read ? 'opacity-80' : 'bg-[color-mix(in_srgb,var(--app-primary)_6%,transparent)]'
                    }`}
                    onClick={() => {
                      markRead(item.id)
                      setOpen(false)
                      if (item.chat_id != null) {
                        navigate(`/admin/chat-center?chat=${item.chat_id}`)
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      {!item.read && (
                        <span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                      )}
                    </div>
                    <span className="line-clamp-2 text-xs text-muted-text">{item.body}</span>
                    <span className="text-[0.65rem] text-muted-text">{formatWhen(item.created_at)}</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="flex items-center justify-end border-t border-border px-3 py-2">
            <Link
              to="/admin/chat-center"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setOpen(false)}
            >
              Open Chat Center
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
