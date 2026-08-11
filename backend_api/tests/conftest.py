"""Shared fixtures for the support-ticket test suite.

The fixtures below build a *minimal* FastAPI app that only mounts the
tickets router, backed by an isolated in-memory SQLite database. This
keeps the tests fast and independent from Postgres-only migration code
in ``backend_api.db.session.init_db`` (which the production app runs on
startup) while still exercising the real router, service, schema and
auth-dependency code paths.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from backend_api.db.base import Base
from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.routers import tickets as tickets_router
from backend_api.http.services.auth_service import create_access_token, hash_password


@pytest.fixture()
def engine():
    """A fresh in-memory SQLite database per test."""
    eng = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=eng)
    try:
        yield eng
    finally:
        Base.metadata.drop_all(bind=eng)
        eng.dispose()


@pytest.fixture()
def session_factory(engine) -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture()
def db_session(session_factory) -> Iterator[Session]:
    db = session_factory()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def app(session_factory) -> FastAPI:
    def _get_db_override() -> Iterator[Session]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    test_app = FastAPI()
    test_app.include_router(tickets_router.router, prefix="/api")
    test_app.dependency_overrides[get_db] = _get_db_override
    return test_app


@pytest.fixture()
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def make_user(db_session: Session, *, email: str, is_admin: bool = False) -> User:
    user = User(
        email=email,
        password_hash=hash_password("Password123!"),
        is_admin=is_admin,
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def normal_user(db_session) -> User:
    return make_user(db_session, email="user@example.com")


@pytest.fixture()
def other_user(db_session) -> User:
    return make_user(db_session, email="other-user@example.com")


@pytest.fixture()
def admin_user(db_session) -> User:
    return make_user(db_session, email="admin@example.com", is_admin=True)


def auth_headers(user: User) -> dict[str, str]:
    token = create_access_token(user.id, user.email)
    return {"Authorization": f"Bearer {token}"}
