"""Live chat sessions, messages, and in-memory WebSocket fan-out."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import WebSocket
from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import ChatMessage, ChatSession, User

CHAT_STATUS_OPEN = "open"
CHAT_STATUS_ACTIVE = "active"
CHAT_STATUS_CLOSED = "closed"
OPEN_STATUSES = {CHAT_STATUS_OPEN, CHAT_STATUS_ACTIVE}


class ConnectionManager:
    """Track active WebSocket connections per chat session."""

    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, chat_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._rooms[chat_id].add(websocket)

    def disconnect(self, chat_id: int, websocket: WebSocket) -> None:
        sockets = self._rooms.get(chat_id)
        if not sockets:
            return
        sockets.discard(websocket)
        if not sockets:
            self._rooms.pop(chat_id, None)

    def online_count(self, chat_id: int) -> int:
        return len(self._rooms.get(chat_id, ()))

    async def broadcast(self, chat_id: int, payload: dict) -> None:
        sockets = list(self._rooms.get(chat_id, ()))
        dead: list[WebSocket] = []
        data = json.dumps(payload, default=str)
        for websocket in sockets:
            try:
                await websocket.send_text(data)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(chat_id, websocket)


manager = ConnectionManager()


def message_to_out(message: ChatMessage) -> dict:
    return {
        "id": message.id,
        "chat_session_id": message.chat_session_id,
        "sender_id": message.sender_id,
        "sender_email": message.sender.email if message.sender is not None else None,
        "message": message.message,
        "created_at": message.created_at,
    }


def session_to_list_item(session: ChatSession) -> dict:
    return {
        "id": session.id,
        "user_id": session.user_id,
        "user_email": session.user.email if session.user is not None else None,
        "agent_id": session.agent_id,
        "agent_email": session.agent.email if session.agent is not None else None,
        "status": session.status,
        "created_at": session.created_at,
        "closed_at": session.closed_at,
    }


def session_to_out(session: ChatSession, *, include_messages: bool = True) -> dict:
    payload = session_to_list_item(session)
    if include_messages:
        messages = session.messages or []
        payload["messages"] = [message_to_out(m) for m in messages]
    else:
        payload["messages"] = []
    return payload


def can_access_session(user: User, session: ChatSession) -> bool:
    if user.is_admin:
        return True
    return session.user_id == user.id or session.agent_id == user.id


def create_session(
    db: Session,
    user: User,
    *,
    message: str | None = None,
) -> ChatSession:
    now = datetime.now(timezone.utc)
    session = ChatSession(
        user_id=user.id,
        agent_id=None,
        status=CHAT_STATUS_OPEN,
        created_at=now,
        closed_at=None,
    )
    db.add(session)
    db.flush()

    if message and message.strip():
        db.add(
            ChatMessage(
                chat_session_id=session.id,
                sender_id=user.id,
                message=message.strip(),
                created_at=now,
            )
        )

    db.commit()
    return get_session(db, session.id)  # type: ignore[return-value]


def list_sessions(
    db: Session,
    user: User,
    *,
    status: str | None = None,
) -> list[ChatSession]:
    query = db.query(ChatSession).options(
        joinedload(ChatSession.user),
        joinedload(ChatSession.agent),
    )
    if not user.is_admin:
        query = query.filter(
            (ChatSession.user_id == user.id) | (ChatSession.agent_id == user.id)
        )
    if status and status != "all":
        query = query.filter(ChatSession.status == status)
    return query.order_by(ChatSession.created_at.desc()).all()


def get_session(db: Session, chat_id: int) -> ChatSession | None:
    return (
        db.query(ChatSession)
        .options(
            joinedload(ChatSession.user),
            joinedload(ChatSession.agent),
            joinedload(ChatSession.messages).joinedload(ChatMessage.sender),
        )
        .filter(ChatSession.id == chat_id)
        .first()
    )


def join_session(db: Session, session: ChatSession, agent: User) -> ChatSession:
    if session.status == CHAT_STATUS_CLOSED:
        raise ValueError("Chat session is closed")
    session.agent_id = agent.id
    if session.status == CHAT_STATUS_OPEN:
        session.status = CHAT_STATUS_ACTIVE
    db.commit()
    return get_session(db, session.id)  # type: ignore[return-value]


def close_session(db: Session, session: ChatSession) -> ChatSession:
    if session.status == CHAT_STATUS_CLOSED:
        return session
    session.status = CHAT_STATUS_CLOSED
    session.closed_at = datetime.now(timezone.utc)
    db.commit()
    return get_session(db, session.id)  # type: ignore[return-value]


def list_messages(db: Session, chat_id: int) -> list[ChatMessage]:
    return (
        db.query(ChatMessage)
        .options(joinedload(ChatMessage.sender))
        .filter(ChatMessage.chat_session_id == chat_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )


def add_message(
    db: Session,
    session: ChatSession,
    sender: User,
    *,
    message: str,
) -> ChatMessage:
    if session.status == CHAT_STATUS_CLOSED:
        raise ValueError("Chat session is closed")

    text = message.strip()
    if not text:
        raise ValueError("Message is required")

    if session.agent_id is None and sender.is_admin and sender.id != session.user_id:
        session.agent_id = sender.id
        session.status = CHAT_STATUS_ACTIVE

    row = ChatMessage(
        chat_session_id=session.id,
        sender_id=sender.id,
        message=text,
        created_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    loaded = (
        db.query(ChatMessage)
        .options(joinedload(ChatMessage.sender))
        .filter(ChatMessage.id == row.id)
        .first()
    )
    return loaded  # type: ignore[return-value]


def message_event_payload(message: ChatMessage) -> dict:
    return {
        "type": "message",
        **message_to_out(message),
    }


def presence_event_payload(chat_id: int, *, user_id: int, online: bool) -> dict:
    return {
        "type": "presence",
        "chat_id": chat_id,
        "user_id": user_id,
        "online": online,
        "online_count": manager.online_count(chat_id),
    }


def status_event_payload(session: ChatSession) -> dict:
    return {
        "type": "status",
        **session_to_list_item(session),
    }
