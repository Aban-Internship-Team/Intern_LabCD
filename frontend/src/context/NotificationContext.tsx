import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppNotification, NotificationSocketEvent } from '../api/types'
import { chatCenterApi } from '../api/chatCenter'
import { useAuth } from './AuthContext'

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
  setActiveChatId: (chatId: number | null) => void
  markNotificationsForChatRead: (chatId: number) => void
  pushNotification: (notification: AppNotification, options?: { silent?: boolean }) => void
  markRead: (id: number) => void
  markAllRead: () => void
  dismissToast: (id: number) => void
  refreshNotifications: () => Promise<void>
}

const NotificationContext = createContext<NotificationContextValue | null>(null)

function playSoftChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
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
    // Browsers may block audio until the user interacts with the page.
  }
}

function isNotificationEvent(data: unknown): data is NotificationSocketEvent {
  if (!data || typeof data !== 'object') return false
  const type = (data as { type?: unknown }).type
  return type === 'notification' || type === 'unread_summary'
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth()
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [soundEnabled, setSoundEnabled] = useState(true)
  const toastSeq = useRef(1)
  const soundEnabledRef = useRef(soundEnabled)
  const activeChatIdRef = useRef<number | null>(null)

  useEffect(() => {
    soundEnabledRef.current = soundEnabled
  }, [soundEnabled])

  const markNotificationsForChatRead = useCallback((chatId: number) => {
    setNotifications((prev) => {
      if (!prev.some((item) => item.chat_id === chatId && !item.read)) return prev
      return prev.map((item) => (item.chat_id === chatId ? { ...item, read: true } : item))
    })
    setToasts((prev) => prev.filter((toast) => toast.chatId !== chatId))
  }, [])

  const setActiveChatId = useCallback(
    (chatId: number | null) => {
      activeChatIdRef.current = chatId
      if (chatId != null) markNotificationsForChatRead(chatId)
    },
    [markNotificationsForChatRead],
  )

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const pushNotification = useCallback(
    (notification: AppNotification, options?: { silent?: boolean }) => {
      const viewingSameChat =
        notification.chat_id != null && notification.chat_id === activeChatIdRef.current
      const nextNotification = viewingSameChat ? { ...notification, read: true } : notification

      setNotifications((prev) => {
        if (prev.some((item) => item.id === nextNotification.id)) {
          return prev.map((item) => (item.id === nextNotification.id ? nextNotification : item))
        }
        return [nextNotification, ...prev]
      })

      window.dispatchEvent(
        new CustomEvent('chat-center:notification', { detail: nextNotification }),
      )

      if (viewingSameChat && !notification.read) {
        void chatCenterApi.markNotificationRead(notification.id)
      }

      if (options?.silent || viewingSameChat) return

      const toastId = toastSeq.current++
      setToasts((prev) =>
        [
          {
            id: toastId,
            title: notification.title,
            body: notification.body,
            chatId: notification.chat_id,
          },
          ...prev,
        ].slice(0, 3),
      )
      window.setTimeout(() => dismissToast(toastId), 4200)

      if (soundEnabledRef.current && !notification.read) playSoftChime()
    },
    [dismissToast],
  )

  const refreshNotifications = useCallback(async () => {
    if (!token) {
      setNotifications([])
      return
    }
    try {
      const rows = await chatCenterApi.listNotifications()
      setNotifications(rows)
    } catch {
      // Keep the last known state. Auth/API errors are handled by the shared client.
    }
  }, [token])

  const markRead = useCallback(
    (id: number) => {
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read: true } : item)),
      )
      void chatCenterApi.markNotificationRead(id).catch(() => void refreshNotifications())
    },
    [refreshNotifications],
  )

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((item) => ({ ...item, read: true })))
    void chatCenterApi.markAllNotificationsRead().catch(() => void refreshNotifications())
  }, [refreshNotifications])

  useEffect(() => {
    if (!token) {
      setNotifications([])
      setToasts([])
      return
    }

    let socket: WebSocket | null = null
    let reconnectTimer: number | null = null
    let stopped = false

    const connect = () => {
      if (stopped) return
      const url = chatCenterApi.notificationWsUrl()
      if (!url) {
        reconnectTimer = window.setTimeout(connect, 1500)
        return
      }

      void refreshNotifications()
      socket = new WebSocket(url)
      socket.onmessage = (event) => {
        try {
          const data: unknown = JSON.parse(String(event.data))
          if (!isNotificationEvent(data)) return
          if (data.type === 'notification' && data.payload) {
            pushNotification(data.payload)
          } else if (data.type === 'unread_summary') {
            void refreshNotifications()
          }
        } catch {
          // Ignore malformed socket frames.
        }
      }
      socket.onclose = () => {
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1500)
      }
      socket.onerror = () => socket?.close()
    }

    connect()
    const refreshTimer = window.setInterval(() => {
      void refreshNotifications()
    }, 30_000)

    return () => {
      stopped = true
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer)
      window.clearInterval(refreshTimer)
      socket?.close()
    }
  }, [token, pushNotification, refreshNotifications])

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
      setActiveChatId,
      markNotificationsForChatRead,
      pushNotification,
      markRead,
      markAllRead,
      dismissToast,
      refreshNotifications,
    }),
    [
      notifications,
      unreadCount,
      toasts,
      soundEnabled,
      setActiveChatId,
      markNotificationsForChatRead,
      pushNotification,
      markRead,
      markAllRead,
      dismissToast,
      refreshNotifications,
    ],
  )

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
}

export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext)
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider')
  return ctx
}
