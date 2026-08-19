"""REST and WebSocket routes for lightweight in-app notifications."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import SessionLocal, get_db
from backend_api.http.dependencies import get_current_user
from backend_api.http.schemas.notifications import NotificationOut, NotificationUnreadCount
from backend_api.http.services import auth_service, chat_service, notification_service

router = APIRouter(tags=["notifications"])
ws_router = APIRouter(tags=["notifications"])


@router.get("/notifications", response_model=list[NotificationOut])
def list_notifications(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[NotificationOut]:
    rows = notification_service.list_notifications(db, user)
    return [NotificationOut.model_validate(notification_service.notification_to_out(row)) for row in rows]


@router.get("/notifications/unread-count", response_model=NotificationUnreadCount)
def get_unread_count(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationUnreadCount:
    return NotificationUnreadCount(count=notification_service.unread_count(db, user))


@router.post("/notifications/read-all", response_model=NotificationUnreadCount)
def mark_all_read(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationUnreadCount:
    notification_service.mark_all_read(db, user)
    return NotificationUnreadCount(count=0)


@router.post("/notifications/{notification_id}/read", response_model=NotificationOut)
def mark_notification_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationOut:
    row = notification_service.get_notification(db, notification_id, user)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    updated = notification_service.mark_notification_read(db, row)
    return NotificationOut.model_validate(notification_service.notification_to_out(updated))


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


@ws_router.websocket("/ws/notifications")
async def notifications_websocket(websocket: WebSocket) -> None:
    """Global badge/toast channel. Auth via `?access_token=` query param."""

    token = websocket.query_params.get("access_token")
    db = SessionLocal()
    user: User | None = None
    try:
        user = _authenticate_ws_user(db, token)
        if user is None:
            await websocket.close(code=4401)
            return

        await notification_service.manager.connect(user.id, websocket)
        await websocket.send_text(
            json.dumps(
                {
                    "type": "unread_summary",
                    "chat_unread_total": chat_service.total_unread_count(db, user),
                    "notification_unread": notification_service.unread_count(db, user),
                }
            )
        )
        try:
            # This socket is server-push only. Receiving keeps disconnects observable.
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            pass
    finally:
        if user is not None:
            notification_service.manager.disconnect(user.id, websocket)
        db.close()
