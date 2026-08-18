import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppNotification } from '../api/types'

export interface ToastItem {
  id: number
  title: string
  body: string
  chatId: number | null
}

interface NotificationContextValue {
  notifications: AppNotification[]
  unreadCount: number
  toasts: ToastItem[]
  soundEnabled: boolean
  setSoundEnabled: (enabled: boolean) => void
  pushNotification: (notification: AppNotification, options?: { silent?: boolean }) => void
  markRead: (id: number) => void
  markAllRead: () => void
  dismissToast: (id: number) => void
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

const INITIAL_NOTIFICATIONS: AppNotification[] = [
  {
    id: 1,
    type: 'chat_message',
    title: 'New chat message',
    body: 'alex@example.com: The export button still returns 500.',
    chat_id: 101,
    read: false,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 2,
    type: 'chat_message',
    title: 'New chat message',
    body: 'sam@example.com: Hi — need help with my plan upgrade.',
    chat_id: 102,
    read: false,
    created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    id: 3,
    type: 'chat_message',
    title: 'Chat closed',
    body: 'Conversation #103 was closed.',
    chat_id: 103,
    read: true,
    created_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  },
]

function playSoftChime(): void {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = 880
    gain.gain.value = 0.04
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35)
    oscillator.stop(ctx.currentTime + 0.4)
    window.setTimeout(() => void ctx.close(), 500)
  } catch {
    // Ignore autoplay / AudioContext failures.
  }
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<AppNotification[]>(INITIAL_NOTIFICATIONS)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const toastSeq = useRef(1)

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const pushNotification = useCallback(
    (notification: AppNotification, options?: { silent?: boolean }) => {
      setNotifications((prev) => {
        if (prev.some((item) => item.id === notification.id)) {
          return prev.map((item) => (item.id === notification.id ? notification : item))
        }
        return [notification, ...prev]
      })

      if (options?.silent) return

      const toastId = toastSeq.current++
      setToasts((prev) => [
        {
          id: toastId,
          title: notification.title,
          body: notification.body,
          chatId: notification.chat_id,
        },
        ...prev,
      ].slice(0, 3))
      window.setTimeout(() => dismissToast(toastId), 4200)

      if (soundEnabled && !notification.read) {
        playSoftChime()
      }
    },
    [dismissToast, soundEnabled],
  )

  const markRead = useCallback((id: number) => {
    setNotifications((prev) =>
      prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
    )
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
  }, [])

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.read).length,
    [notifications],
  )

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      toasts,
      soundEnabled,
      setSoundEnabled,
      pushNotification,
      markRead,
      markAllRead,
      dismissToast,
    }),
    [
      notifications,
      unreadCount,
      toasts,
      soundEnabled,
      pushNotification,
      markRead,
      markAllRead,
      dismissToast,
    ],
  )

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  )
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) {
    throw new Error('useNotifications must be used within NotificationProvider')
  }
  return ctx
}
