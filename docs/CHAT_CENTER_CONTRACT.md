# Chat Center & Notification API Contract

Shared contract for the Chat Center + Notification phase.
Keep this file in sync when either teammate changes request/response shapes.

**Base URL:** `/api/v1`  
**Auth:** `Authorization: Bearer <JWT>` (WebSocket: `?access_token=<JWT>`)

---

## Goals (v1)

- One concentrated **Chat Center** UI for admins (inbox + thread).
- Lightweight **notifications** with badge / toast / optional sound.
- Normal chat extras: **unread counts**, light **presence**, mark-as-read.
- Out of v1 unless explicitly requested: file attachments, typing indicators, group chat, mobile push.

---

## A) Chat list enrichment

### `GET /api/v1/chats`

Existing query params remain (`status=open|active|closed|all`).

Each list item **extends** the current chat session summary:

```json
{
  "id": 1,
  "user_id": 12,
  "user_email": "user@example.com",
  "agent_id": 1,
  "agent_email": "admin@example.com",
  "status": "active",
  "created_at": "2026-08-18T10:00:00Z",
  "closed_at": null,
  "unread_count": 3,
  "last_message_preview": "Thanks — can you check the export?",
  "last_message_at": "2026-08-18T10:05:12Z",
  "peer_online": false
}
```

| Field | Type | Notes |
|-------|------|--------|
| `unread_count` | `number` | Unread messages for the **current** authenticated user |
| `last_message_preview` | `string \| null` | Truncated last message body |
| `last_message_at` | `string \| null` | ISO datetime of last message |
| `peer_online` | `boolean` | Best-effort: other participant connected to that chat WS room |

Detail endpoint `GET /api/v1/chats/{chat_id}` may include the same enrichment fields (optional in v1).

---

## B) Mark chat as read

### `POST /api/v1/chats/{chat_id}/read`

Marks the chat as read for the current user (updates read cursor / clears unread).

**Response (preferred):**

```json
{
  "chat_id": 1,
  "unread_count": 0
}
```

Alternatively `204 No Content` is acceptable if list is refreshed after call.

---

## C) Notifications REST

### Models (logical)

```text
Notification
- id
- user_id
- type          # e.g. "chat_message"
- title
- body
- chat_id       # nullable FK to chat session
- read          # bool
- created_at
```

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/notifications` | List notifications for current user (newest first) |
| `GET` | `/api/v1/notifications/unread-count` | Badge number |
| `POST` | `/api/v1/notifications/{id}/read` | Mark one as read |
| `POST` | `/api/v1/notifications/read-all` | Mark all as read |

### Example item

```json
{
  "id": 10,
  "type": "chat_message",
  "title": "New chat message",
  "body": "User asked about export...",
  "chat_id": 1,
  "read": false,
  "created_at": "2026-08-18T10:05:12Z"
}
```

### Unread count response

```json
{
  "count": 2
}
```

### When to create a notification (backend)

On new chat message, create a notification for the **other** party (and/or watching admins), then push over the notifications WebSocket (section D).

---

## D) Notifications WebSocket

### Connect

```text
WS /ws/notifications?access_token=<JWT>
```

Mounted **without** `/api/v1` prefix (same pattern as `/ws/chats/{chat_id}`).

### Server → client events

**New notification:**

```json
{
  "type": "notification",
  "payload": {
    "id": 10,
    "type": "chat_message",
    "title": "New chat message",
    "body": "User asked about export...",
    "chat_id": 1,
    "read": false,
    "created_at": "2026-08-18T10:05:12Z"
  }
}
```

**Unread summary (optional but recommended after connect / after read):**

```json
{
  "type": "unread_summary",
  "chat_unread_total": 5,
  "notification_unread": 2
}
```

Chat message transport remains on existing:

```text
WS /ws/chats/{chat_id}?access_token=<JWT>
```

Do **not** replace per-chat messaging with the notifications socket.

---

## E) Existing chat endpoints (unchanged ownership)

These stay as-is unless both teammates agree to change them:

| Method | Path |
|--------|------|
| `POST` | `/api/v1/chats` |
| `GET` | `/api/v1/chats` |
| `GET` | `/api/v1/chats/{chat_id}` |
| `POST` | `/api/v1/chats/{chat_id}/join` |
| `PATCH` | `/api/v1/chats/{chat_id}/close` |
| `GET/POST` | `/api/v1/chats/{chat_id}/messages` |
| `WS` | `/ws/chats/{chat_id}` |

---

## F) File ownership / decoupling

| Owner | Owns | Must not casually edit |
|-------|------|-------------------------|
| **Teammate A (Nima) — Frontend Chat Center & notif UI** | Chat Center page, bell/badge/toast/sound UI, `AdminLayout` nav wiring, frontend types/clients that **consume** this contract | Backend models/services/routers for unread & notifications |
| **Teammate B — Backend unread & notifications** | DB models, chat list enrichment, `POST .../read`, notifications REST + `WS /ws/notifications`, related tests | Chat Center page layout / toast UX without agreement |

**Integration rule:** Teammate B ships contract-compatible JSON first (even with stubs). Teammate A builds UI against this document and switches from mock → live API when endpoints exist.

---

## G) Suggested frontend route (Teammate A)

- Page: `/admin/chat-center`
- Sidebar label: **Chat Center**
- Pattern: master-detail (conversation list | thread panel)

---

## H) Out of scope (v1)

- File / image attachments in chat
- Typing indicators
- Delivery receipts beyond simple unread / optional `last_read_at`
- Multi-user group rooms
- Browser push / mobile push
