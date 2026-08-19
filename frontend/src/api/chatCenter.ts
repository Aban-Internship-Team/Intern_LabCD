import { apiFetch, getAuthToken } from './client'
import { chatsApi } from './endpoints'
import type {
  AppNotification,
  ChatMessage,
  ChatReadResult,
  ChatSessionListItem,
  NotificationUnreadCount,
} from './types'

function wsBase(): string {
  const explicit = import.meta.env.VITE_WS_BASE_URL as string | undefined
  if (explicit) return explicit.replace(/\/$/, '')
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function withToken(path: string): string | null {
  const token = getAuthToken()
  if (!token) return null
  return `${wsBase()}${path}?access_token=${encodeURIComponent(token)}`
}

export const chatCenterApi = {
  listChats: (): Promise<ChatSessionListItem[]> => chatsApi.list({ status: 'all' }),
  listMessages: (chatId: number): Promise<ChatMessage[]> => chatsApi.listMessages(chatId),
  sendMessage: (chatId: number, message: string): Promise<ChatMessage> =>
    chatsApi.sendMessage(chatId, { message }),
  markChatRead: (chatId: number): Promise<ChatReadResult> =>
    apiFetch<ChatReadResult>(`/chats/${chatId}/read`, { method: 'POST' }),

  listNotifications: (): Promise<AppNotification[]> =>
    apiFetch<AppNotification[]>('/notifications'),
  unreadNotificationCount: (): Promise<NotificationUnreadCount> =>
    apiFetch<NotificationUnreadCount>('/notifications/unread-count'),
  markNotificationRead: (notificationId: number): Promise<AppNotification> =>
    apiFetch<AppNotification>(`/notifications/${notificationId}/read`, { method: 'POST' }),
  markAllNotificationsRead: (): Promise<NotificationUnreadCount> =>
    apiFetch<NotificationUnreadCount>('/notifications/read-all', { method: 'POST' }),

  notificationWsUrl: (): string | null => withToken('/ws/notifications'),
  chatWsUrl: (chatId: number): string | null => withToken(`/ws/chats/${chatId}`),
}
