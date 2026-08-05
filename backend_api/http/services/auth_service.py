"""Authentication helpers: passwords, JWT, and seeding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

import bcrypt
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from backend_api.db.models import Action, Plan, User
from backend_api.http.config import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    DEFAULT_LLM_MODELS,
    JWT_ALGORITHM,
    JWT_EXPIRE_MINUTES,
    JWT_SECRET,
)

# Seed actions for plan entitlements. Interns can add module actions here.
DEFAULT_ACTIONS: list[tuple[str, str]] = [
    ("module:admin", "Access admin features (example action)"),
]

PIPELINE_ACTIONS: dict[str, str] = {}

MODULE_ACTIONS: dict[str, str] = {
    "admin": "module:admin",
}

DEFAULT_PLANS: list[tuple[str, str, Decimal, list[str], list[str]]] = [
    (
        "Free",
        "Default plan for new registrations.",
        Decimal("0.00"),
        [],
        list(DEFAULT_LLM_MODELS)[:1] or ["gpt-4o-mini"],
    ),
]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: int, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError as exc:
        raise ValueError("Invalid or expired token") from exc


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == email.lower().strip()).first()


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def ensure_actions(db: Session, codes: list[str]) -> list[Action]:
    """Return Action rows for codes, creating missing ones."""
    actions: list[Action] = []
    for code in codes:
        normalized = code.strip()
        if not normalized:
            continue
        action = db.query(Action).filter(Action.code == normalized).first()
        if action is None:
            action = Action(code=normalized, description="")
            db.add(action)
            db.flush()
        actions.append(action)
    return actions


def create_user(
    db: Session,
    *,
    email: str,
    password: str,
    plan_id: int | None = None,
    is_admin: bool = False,
    assign_default_plan: bool = True,
) -> User:
    from backend_api.http.services import plan_service

    resolved_plan_id = plan_id
    if resolved_plan_id is None and assign_default_plan and not is_admin:
        resolved_plan_id = plan_service.get_default_plan_id(db)

    user = User(
        email=email.lower().strip(),
        password_hash=hash_password(password),
        is_admin=is_admin,
        is_active=True,
        plan_id=resolved_plan_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    user = get_user_by_email(db, email)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


def _ensure_default_plans(db: Session) -> Plan:
    from backend_api.http.services import plan_service

    free_plan: Plan | None = None
    for name, description, price, codes, models in DEFAULT_PLANS:
        plan = plan_service.get_plan_by_name(db, name)
        if plan is None:
            plan = Plan(
                name=name,
                description=description,
                price=price,
                is_active=True,
                allowed_models=plan_service.normalize_plan_models(models),
            )
            db.add(plan)
            db.flush()
            if codes:
                plan.actions = ensure_actions(db, codes)
        if name == "Free":
            free_plan = plan

    db.commit()

    if free_plan is None:
        free_plan = plan_service.get_plan_by_name(db, "Free")
    assert free_plan is not None

    if plan_service.get_default_plan_id(db) is None:
        plan_service.set_default_plan(db, free_plan.id)

    return free_plan


def seed_auth_data(db: Session) -> None:
    for code, description in DEFAULT_ACTIONS:
        action = db.query(Action).filter(Action.code == code).first()
        if action is None:
            db.add(Action(code=code, description=description))
        elif not action.description:
            action.description = description
    db.commit()

    free_plan = _ensure_default_plans(db)

    # Rename legacy reserved-domain admin if present (email-validator rejects .local).
    legacy_admin = get_user_by_email(db, "admin@labcd.local")
    admin = get_user_by_email(db, ADMIN_EMAIL)
    if legacy_admin is not None and admin is None:
        legacy_admin.email = ADMIN_EMAIL.lower().strip()
        db.add(legacy_admin)
        db.commit()
        admin = legacy_admin

    if admin is None:
        create_user(
            db,
            email=ADMIN_EMAIL,
            password=ADMIN_PASSWORD,
            plan_id=None,
            is_admin=True,
            assign_default_plan=False,
        )
    elif admin.plan_id is None and not admin.is_admin:
        admin.plan_id = free_plan.id
        db.add(admin)
        db.commit()
