"""REST and WebSocket routes for live support chat."""

from __future__ import annotations

import json

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from sqlalchemy.orm import Session

from backend_api.db.models import ChatMessage, ChatSession, User
from backend_api.db.session import SessionLocal, get_db
from backend_api.http.dependencies import get_current_user, require_admin
from backend_api.http.schemas.chats import (
    ChatMessageCreate,
    ChatMessageOut,
    ChatReadOut,
    ChatSessionCreate,
    ChatSessionListItem,
    ChatSessionOut,
)
from backend_api.http.services import auth_service, chat_service, notification_service

router = APIRouter(tags=["chats"])
ws_router = APIRouter(tags=["chats"])


def _require_session_access(user: User, session: ChatSession | None) -> None:
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    if not chat_service.can_access_session(user, session):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


async def _notify_new_message(
    db: Session,
    session: ChatSession,
    message: ChatMessage,
    sender: User,
) -> None:
    notifications = notification_service.create_chat_message_notifications(
        db,
        session,
        message,
        sender,
    )
    for notification in notifications:
        await notification_service.manager.send_to_user(
            notification.user_id,
            notification_service.notification_event_payload(notification),
        )


@router.post("/chats", response_model=ChatSessionOut, status_code=status.HTTP_201_CREATED)
async def create_chat(
    body: ChatSessionCreate | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    message_text = body.message if body is not None else None
    session = chat_service.create_session(db, user, message=message_text)
    if message_text:
        messages = chat_service.list_messages(db, session.id)
        if messages:
            await _notify_new_message(db, session, messages[-1], user)
    return ChatSessionOut.model_validate(chat_service.session_to_out(session))


@router.get("/chats", response_model=list[ChatSessionListItem])
def list_chats(
    chat_status: str | None = Query(
        None,
        alias="status",
        pattern="^(open|active|closed|all)$",
    ),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatSessionListItem]:
    rows = chat_service.list_sessions(db, user, status=chat_status)
    return [
        ChatSessionListItem.model_validate(chat_service.session_to_list_item(db, row, user))
        for row in rows
    ]


@router.get("/chats/{chat_id}", response_model=ChatSessionOut)
def get_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    session = chat_service.get_session(db, chat_id)
    _require_session_access(user, session)
    return ChatSessionOut.model_validate(chat_service.session_to_out(session))


@router.post("/chats/{chat_id}/read", response_model=ChatReadOut)
async def mark_chat_read(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatReadOut:
    session = chat_service.get_session(db, chat_id)
    _require_session_access(user, session)
    unread_count = chat_service.mark_read(db, session, user)
    notification_service.mark_chat_notifications_read(db, user, chat_id)
    await notification_service.manager.send_to_user(
        user.id,
        {
            "type": "unread_summary",
            "chat_unread_total": chat_service.total_unread_count(db, user),
            "notification_unread": notification_service.unread_count(db, user),
        },
    )
    return ChatReadOut(chat_id=chat_id, unread_count=unread_count)


@router.post("/chats/{chat_id}/join", response_model=ChatSessionOut)
def join_chat(
    chat_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    session = chat_service.get_session(db, chat_id)
    if session is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    try:
        updated = chat_service.join_session(db, session, admin)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return ChatSessionOut.model_validate(chat_service.session_to_out(updated))


@router.patch("/chats/{chat_id}/close", response_model=ChatSessionOut)
async def close_chat(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatSessionOut:
    session = chat_service.get_session(db, chat_id)
    _require_session_access(user, session)
    updated = chat_service.close_session(db, session)
    await chat_service.manager.broadcast(chat_id, chat_service.status_event_payload(updated))
    return ChatSessionOut.model_validate(chat_service.session_to_out(updated))


@router.get("/chats/{chat_id}/messages", response_model=list[ChatMessageOut])
def get_chat_messages(
    chat_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ChatMessageOut]:
    session = chat_service.get_session(db, chat_id)
    _require_session_access(user, session)
    messages = chat_service.list_messages(db, chat_id)
    return [ChatMessageOut.model_validate(chat_service.message_to_out(m)) for m in messages]


@router.post(
    "/chats/{chat_id}/messages",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def post_chat_message(
    chat_id: int,
    body: ChatMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ChatMessageOut:
    session = chat_service.get_session(db, chat_id)
    _require_session_access(user, session)
    try:
        message = chat_service.add_message(db, session, user, message=body.message)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    payload = chat_service.message_event_payload(message)
    await chat_service.manager.broadcast(chat_id, payload)
    await _notify_new_message(db, session, message, user)
    return ChatMessageOut.model_validate(chat_service.message_to_out(message))


def _authenticate_ws_user(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    try:
        payload = auth_service.decode_access_token(token)
        user_id = int(payload["sub"])
    except (ValueError, KeyError, TypeError):
        return None
    user = auth_service.get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        return None
    return user


@ws_router.websocket("/ws/chats/{chat_id}")
async def chat_websocket(websocket: WebSocket, chat_id: int) -> None:
    """Real-time chat channel. Auth via `?access_token=` query param."""

    token = websocket.query_params.get("access_token")
    db = SessionLocal()
    try:
        user = _authenticate_ws_user(db, token)
        if user is None:
            await websocket.close(code=4401)
            return
        session = chat_service.get_session(db, chat_id)
        if session is None or not chat_service.can_access_session(user, session):
            await websocket.close(code=4403)
            return
        if session.status == chat_service.CHAT_STATUS_CLOSED:
            await websocket.close(code=4409)
            return
        await chat_service.manager.connect(chat_id, user.id, websocket)
        await chat_service.manager.broadcast(
            chat_id,
            chat_service.presence_event_payload(chat_id, user_id=user.id, online=True),
        )
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send_text(json.dumps({"type": "error", "detail": "Invalid JSON"}))
                    continue
                text = str(data.get("message") or "").strip()
                if not text:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "Message is required"})
                    )
                    continue
                # Refresh session state before writing.
                session = chat_service.get_session(db, chat_id)
                if session is None:
                    await websocket.send_text(json.dumps({"type": "error", "detail": "Chat not found"}))
                    break
                if session.status == chat_service.CHAT_STATUS_CLOSED:
                    await websocket.send_text(
                        json.dumps({"type": "error", "detail": "Chat session is closed"})
                    )
                    break
                try:
                    message = chat_service.add_message(db, session, user, message=text)
                except ValueError as exc:
                    await websocket.send_text(json.dumps({"type": "error", "detail": str(exc)}))
                    continue
                await chat_service.manager.broadcast(
                    chat_id,
                    chat_service.message_event_payload(message),
                )
                await _notify_new_message(db, session, message, user)
        except WebSocketDisconnect:
            pass
        finally:
            chat_service.manager.disconnect(chat_id, websocket)
            await chat_service.manager.broadcast(
                chat_id,
                chat_service.presence_event_payload(
                    chat_id,
                    user_id=user.id,
                    online=chat_service.manager.is_user_online(chat_id, user.id),
                ),
            )
    finally:
        db.close()
