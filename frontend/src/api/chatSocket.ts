import { getAuthToken } from './client'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

export type ChatSocketEvent =
  | {
      type: 'message'
      id: number
      chat_session_id: number
      sender_id: number
      sender_email: string | null
      message: string
      created_at: string
    }
  | {
      type: 'presence'
      chat_id: number
      user_id: number
      online: boolean
      online_count: number
    }
  | {
      type: 'status'
      id: number
      status: string
      closed_at?: string | null
    }
  | {
      type: 'error'
      detail: string
    }

export type ChatSocketHandlers = {
  onEvent?: (event: ChatSocketEvent) => void
  onOpen?: () => void
  onClose?: (event: CloseEvent) => void
  onError?: (event: Event) => void
}

/** Resolve ws(s):// host for live chat (Vite proxies `/ws` in local dev). */
export function getChatWebSocketBaseUrl(): string {
  const explicit = import.meta.env.VITE_WS_BASE_URL as string | undefined
  if (explicit?.trim()) {
    return explicit.replace(/\/$/, '')
  }

  if (API_BASE.startsWith('http://') || API_BASE.startsWith('https://')) {
    const url = new URL(API_BASE)
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${url.host}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function withAccessToken(path: string, token?: string | null): string {
  const accessToken = token === undefined ? getAuthToken() : token
  const base = getChatWebSocketBaseUrl()
  const query = accessToken ? `?access_token=${encodeURIComponent(accessToken)}` : ''
  return `${base}${path}${query}`
}

export function buildChatWebSocketUrl(chatId: number, token?: string | null): string {
  return withAccessToken(`/ws/chats/${chatId}`, token)
}

export function buildNotificationWebSocketUrl(token?: string | null): string {
  return withAccessToken('/ws/notifications', token)
}

export class ChatWebSocketClient {
  private socket: WebSocket | null = null
  private readonly chatId: number
  private readonly handlers: ChatSocketHandlers

  constructor(chatId: number, handlers: ChatSocketHandlers = {}) {
    this.chatId = chatId
    this.handlers = handlers
  }

  get readyState(): number {
    return this.socket?.readyState ?? WebSocket.CLOSED
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(): void {
    this.disconnect()
    const url = buildChatWebSocketUrl(this.chatId)
    const socket = new WebSocket(url)
    this.socket = socket

    socket.onopen = () => {
      this.handlers.onOpen?.()
    }

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as ChatSocketEvent
        this.handlers.onEvent?.(payload)
      } catch {
        this.handlers.onEvent?.({ type: 'error', detail: 'Invalid WebSocket payload' })
      }
    }

    socket.onerror = (event) => {
      this.handlers.onError?.(event)
    }

    socket.onclose = (event) => {
      this.handlers.onClose?.(event)
      if (this.socket === socket) {
        this.socket = null
      }
    }
  }

  sendMessage(message: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false
    }
    this.socket.send(JSON.stringify({ message }))
    return true
  }

  disconnect(): void {
    if (!this.socket) return
    const socket = this.socket
    this.socket = null
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close()
    }
  }
}
