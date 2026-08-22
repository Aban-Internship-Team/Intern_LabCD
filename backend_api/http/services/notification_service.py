"""Persistence and WebSocket fan-out for lightweight in-app notifications."""

from __future__ import annotations

from collections import defaultdict

from fastapi import WebSocket
from sqlalchemy.orm import Session

from backend_api.db.models import ChatMessage, ChatSession, Notification, User
from backend_api.http.ws_json import dumps_ws_payload

NOTIFICATION_TYPE_CHAT_MESSAGE = "chat_message"
BODY_PREVIEW_LENGTH = 220


class NotificationConnectionManager:
    """Track global notification WebSocket connections per authenticated user."""

    def __init__(self) -> None:
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[user_id].add(websocket)

    def disconnect(self, user_id: int, websocket: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._connections.pop(user_id, None)

    async def send_to_user(self, user_id: int, payload: dict) -> None:
        sockets = list(self._connections.get(user_id, ()))
        dead: list[WebSocket] = []
        data = dumps_ws_payload(payload)
        for websocket in sockets:
            try:
                await websocket.send_text(data)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(user_id, websocket)


manager = NotificationConnectionManager()


def notification_to_out(notification: Notification) -> dict:
    return {
        "id": notification.id,
        "type": notification.type,
        "title": notification.title,
        "body": notification.body,
        "chat_id": notification.chat_id,
        "read": notification.read,
        "created_at": notification.created_at,
    }


def notification_event_payload(notification: Notification) -> dict:
    return {
        "type": "notification",
        "payload": notification_to_out(notification),
    }


def list_notifications(db: Session, user: User) -> list[Notification]:
    return (
        db.query(Notification)
        .filter(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc(), Notification.id.desc())
        .all()
    )


def unread_count(db: Session, user: User) -> int:
    return int(
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read.is_(False))
        .count()
    )


def get_notification(db: Session, notification_id: int, user: User) -> Notification | None:
    return (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.user_id == user.id,
        )
        .first()
    )


def mark_notification_read(db: Session, notification: Notification) -> Notification:
    if not notification.read:
        notification.read = True
        db.commit()
        db.refresh(notification)
    return notification


def mark_all_read(db: Session, user: User) -> int:
    updated = (
        db.query(Notification)
        .filter(Notification.user_id == user.id, Notification.read.is_(False))
        .update({Notification.read: True}, synchronize_session=False)
    )
    db.commit()
    return int(updated)


def mark_chat_notifications_read(db: Session, user: User, chat_id: int) -> int:
    """Mark the current user's notifications for one chat as read."""

    updated = (
        db.query(Notification)
        .filter(
            Notification.user_id == user.id,
            Notification.chat_id == chat_id,
            Notification.read.is_(False),
        )
        .update({Notification.read: True}, synchronize_session=False)
    )
    db.commit()
    return int(updated)


def _recipient_ids_for_chat_message(
    db: Session,
    session: ChatSession,
    sender: User,
) -> list[int]:
    if sender.id == session.user_id:
        if session.agent_id is not None and session.agent_id != sender.id:
            return [session.agent_id]
        # An unassigned user chat needs to be visible to the admin inbox.
        return [
            row[0]
            for row in db.query(User.id)
            .filter(User.is_admin.is_(True), User.is_active.is_(True), User.id != sender.id)
            .all()
        ]

    # Agent/admin -> chat owner.
    return [session.user_id] if session.user_id != sender.id else []


def create_chat_message_notifications(
    db: Session,
    session: ChatSession,
    message: ChatMessage,
    sender: User,
) -> list[Notification]:
    """Persist a notification for the other chat participant / relevant admins."""

    recipient_ids = list(dict.fromkeys(_recipient_ids_for_chat_message(db, session, sender)))
    if not recipient_ids:
        return []

    sender_label = sender.email or f"User #{sender.id}"
    text = message.message.strip()
    body = f"{sender_label}: {text}"
    if len(body) > BODY_PREVIEW_LENGTH:
        body = body[: BODY_PREVIEW_LENGTH - 1].rstrip() + "…"

    rows = [
        Notification(
            user_id=recipient_id,
            type=NOTIFICATION_TYPE_CHAT_MESSAGE,
            title="New chat message",
            body=body,
            chat_id=session.id,
            read=False,
            created_at=message.created_at,
        )
        for recipient_id in recipient_ids
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows
