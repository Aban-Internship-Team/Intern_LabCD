"""FastAPI dependencies for authentication and authorization."""

from __future__ import annotations

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.services.auth_service import decode_access_token, get_user_by_id

bearer_scheme = HTTPBearer(auto_error=False)


def _load_user_from_token(token: str, db: Session) -> User:
    try:
        payload = decode_access_token(token)
        user_id = int(payload["sub"])
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = get_user_by_id(db, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate via Bearer header, or access_token query (for EventSource streams)."""
    token: str | None = None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    elif access_token:
        token = access_token

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return _load_user_from_token(token, db)


def get_optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    access_token: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> User | None:
    """Return the current user when a valid token is present; otherwise None."""
    token: str | None = None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    elif access_token:
        token = access_token
    if not token:
        return None
    try:
        return _load_user_from_token(token, db)
    except HTTPException:
        return None


def require_admin(user: User = Depends(get_current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_action(action_code: str):
    def _dependency(user: User = Depends(get_current_user)) -> User:
        if not user.has_action(action_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing required action: {action_code}",
            )
        return user

    return _dependency


def assert_model_allowed(user: User, model: str | None) -> None:
    """Reject models that are not entitled on the user's plan."""
    if not model or not str(model).strip():
        return
    normalized = str(model).strip()
    if user.has_model(normalized):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=f"Model not allowed for your plan: {normalized}",
    )
