"""Live chat sessions, messages, unread state, and WebSocket fan-out."""

from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import WebSocket
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import ChatMessage, ChatRead, ChatSession, User

CHAT_STATUS_OPEN = "open"
CHAT_STATUS_ACTIVE = "active"
CHAT_STATUS_CLOSED = "closed"
OPEN_STATUSES = {CHAT_STATUS_OPEN, CHAT_STATUS_ACTIVE}
LAST_MESSAGE_PREVIEW_LENGTH = 160


class ConnectionManager:
    """Track active WebSocket connections and users per chat session."""

    def __init__(self) -> None:
        self._rooms: dict[int, set[WebSocket]] = defaultdict(set)
        self._socket_users: dict[WebSocket, int] = {}

    async def connect(self, chat_id: int, user_id: int, websocket: WebSocket) -> None:
        await websocket.accept()
        self._rooms[chat_id].add(websocket)
        self._socket_users[websocket] = user_id

    def disconnect(self, chat_id: int, websocket: WebSocket) -> None:
        sockets = self._rooms.get(chat_id)
        if sockets:
            sockets.discard(websocket)
            if not sockets:
                self._rooms.pop(chat_id, None)
        self._socket_users.pop(websocket, None)

    def online_count(self, chat_id: int) -> int:
        return len(self._rooms.get(chat_id, ()))

    def is_user_online(self, chat_id: int, user_id: int | None) -> bool:
        if user_id is None:
            return False
        return any(
            self._socket_users.get(websocket) == user_id
            for websocket in self._rooms.get(chat_id, ())
        )

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


def _session_base_payload(session: ChatSession) -> dict:
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


def _last_message(db: Session, chat_id: int) -> ChatMessage | None:
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.chat_session_id == chat_id)
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .first()
    )


def get_unread_count(db: Session, chat_id: int, user_id: int) -> int:
    """Count messages from other users after this user's read cursor."""

    read_row = (
        db.query(ChatRead)
        .filter(
            ChatRead.chat_session_id == chat_id,
            ChatRead.user_id == user_id,
        )
        .first()
    )
    query = db.query(func.count(ChatMessage.id)).filter(
        ChatMessage.chat_session_id == chat_id,
        ChatMessage.sender_id != user_id,
    )
    if read_row is not None:
        query = query.filter(ChatMessage.created_at > read_row.last_read_at)
    return int(query.scalar() or 0)


def session_to_list_item(db: Session, session: ChatSession, current_user: User) -> dict:
    last_message = _last_message(db, session.id)
    if current_user.id == session.user_id:
        peer_id = session.agent_id
    else:
        # Admin/support views treat the chat owner as the peer, including
        # unassigned sessions and chats assigned to another agent.
        peer_id = session.user_id

    payload = _session_base_payload(session)
    payload.update(
        {
            "unread_count": get_unread_count(db, session.id, current_user.id),
            "last_message_preview": (
                last_message.message[:LAST_MESSAGE_PREVIEW_LENGTH]
                if last_message is not None
                else None
            ),
            "last_message_at": last_message.created_at if last_message is not None else None,
            "peer_online": manager.is_user_online(session.id, peer_id),
        }
    )
    return payload


def session_to_out(session: ChatSession, *, include_messages: bool = True) -> dict:
    payload = _session_base_payload(session)
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

    # The creator has read their own initial message at creation time.
    db.add(ChatRead(chat_session_id=session.id, user_id=user.id, last_read_at=now))
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


def mark_read(db: Session, session: ChatSession, user: User) -> int:
    """Move the current user's read cursor to now and return the new unread count."""

    now = datetime.now(timezone.utc)
    row = (
        db.query(ChatRead)
        .filter(
            ChatRead.chat_session_id == session.id,
            ChatRead.user_id == user.id,
        )
        .first()
    )
    if row is None:
        row = ChatRead(
            chat_session_id=session.id,
            user_id=user.id,
            last_read_at=now,
        )
        db.add(row)
    else:
        row.last_read_at = now
    db.commit()
    return get_unread_count(db, session.id, user.id)


def total_unread_count(db: Session, user: User) -> int:
    return sum(
        get_unread_count(db, session.id, user.id)
        for session in list_sessions(db, user, status="all")
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
        **_session_base_payload(session),
    }
