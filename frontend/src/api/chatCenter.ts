import { apiFetch, getAuthToken } from './client'
import { chatsApi } from './endpoints'
import { buildChatWebSocketUrl, buildNotificationWebSocketUrl } from './chatSocket'
import type {
  AppNotification,
  ChatMessage,
  ChatReadResult,
  ChatSessionListItem,
  NotificationUnreadCount,
} from './types'

export const chatCenterApi = {
  listChats: (): Promise<ChatSessionListItem[]> => chatsApi.list({ status: 'all' }),
  listMessages: (chatId: number): Promise<ChatMessage[]> => chatsApi.listMessages(chatId),
  sendMessage: (chatId: number, message: string): Promise<ChatMessage> =>
    chatsApi.sendMessage(chatId, { message }),
  markChatRead: (chatId: number): Promise<ChatReadResult> => chatsApi.markRead(chatId),

  listNotifications: (): Promise<AppNotification[]> =>
    apiFetch<AppNotification[]>('/notifications'),
  unreadNotificationCount: (): Promise<NotificationUnreadCount> =>
    apiFetch<NotificationUnreadCount>('/notifications/unread-count'),
  markNotificationRead: (notificationId: number): Promise<AppNotification> =>
    apiFetch<AppNotification>(`/notifications/${notificationId}/read`, { method: 'POST' }),
  markAllNotificationsRead: (): Promise<NotificationUnreadCount> =>
    apiFetch<NotificationUnreadCount>('/notifications/read-all', { method: 'POST' }),

  notificationWsUrl: (): string | null => {
    const token = getAuthToken()
    return token ? buildNotificationWebSocketUrl(token) : null
  },
  chatWsUrl: (chatId: number): string | null => {
    const token = getAuthToken()
    return token ? buildChatWebSocketUrl(chatId, token) : null
  },
}
