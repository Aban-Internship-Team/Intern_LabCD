import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { useNotifications } from '../context/NotificationContext'
import { btnBase, btnCompact } from '../lib/classes'

export function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications()

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-24 right-5 z-[70] flex w-[min(100vw-2rem,22rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-xl border border-border bg-surface-elevated p-3 shadow-xl"
          role="status"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{toast.title}</div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-text">{toast.body}</p>
              {toast.chatId != null && (
                <Link
                  to={`/admin/chat-center?chat=${toast.chatId}`}
                  className="mt-2 inline-block text-xs font-medium text-primary hover:underline"
                  onClick={() => dismissToast(toast.id)}
                >
                  View in Chat Center
                </Link>
              )}
            </div>
            <button
              type="button"
              className={`${btnBase} ${btnCompact}`}
              aria-label="Dismiss notification"
              onClick={() => dismissToast(toast.id)}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
