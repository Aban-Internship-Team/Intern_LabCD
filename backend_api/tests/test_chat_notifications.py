"""Tests for chat unread state and lightweight notifications."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend_api.db.models import Notification
from backend_api.db.session import get_db
from backend_api.http.routers import chats as chats_router
from backend_api.http.routers import notifications as notifications_router
from backend_api.tests.conftest import auth_headers


@pytest.fixture()
def chat_app(session_factory) -> FastAPI:
    def _get_db_override() -> Iterator[Session]:
        db = session_factory()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(chats_router.router, prefix="/api")
    app.include_router(notifications_router.router, prefix="/api")
    app.dependency_overrides[get_db] = _get_db_override
    return app


@pytest.fixture()
def chat_client(chat_app) -> Iterator[TestClient]:
    with TestClient(chat_app) as client:
        yield client


def create_chat(chat_client, user, message="Hello support"):
    return chat_client.post(
        "/api/chats",
        json={"message": message},
        headers=auth_headers(user),
    )


def test_chat_list_enrichment_counts_peer_messages(
    chat_client,
    normal_user,
    admin_user,
):
    created = create_chat(chat_client, normal_user, "Please help with export")
    assert created.status_code == 201

    resp = chat_client.get("/api/chats?status=all", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    item = resp.json()[0]
    assert item["unread_count"] == 1
    assert item["last_message_preview"] == "Please help with export"
    assert item["last_message_at"] is not None
    assert item["peer_online"] is False


def test_own_initial_message_is_not_unread(chat_client, normal_user):
    create_chat(chat_client, normal_user, "My own message")
    resp = chat_client.get("/api/chats?status=all", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert resp.json()[0]["unread_count"] == 0


def test_mark_chat_read_clears_unread(chat_client, normal_user, admin_user):
    chat = create_chat(chat_client, normal_user).json()

    before = chat_client.get("/api/chats?status=all", headers=auth_headers(admin_user)).json()[0]
    assert before["unread_count"] == 1

    resp = chat_client.post(
        f"/api/chats/{chat['id']}/read",
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    assert resp.json() == {"chat_id": chat["id"], "unread_count": 0}

    after = chat_client.get("/api/chats?status=all", headers=auth_headers(admin_user)).json()[0]
    assert after["unread_count"] == 0


def test_user_cannot_mark_someone_elses_chat_read(
    chat_client,
    normal_user,
    other_user,
):
    chat = create_chat(chat_client, normal_user).json()
    resp = chat_client.post(
        f"/api/chats/{chat['id']}/read",
        headers=auth_headers(other_user),
    )
    assert resp.status_code == 403


def test_initial_user_message_creates_admin_notification(
    chat_client,
    normal_user,
    admin_user,
):
    chat = create_chat(chat_client, normal_user, "New inbox item").json()

    resp = chat_client.get("/api/notifications", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["type"] == "chat_message"
    assert rows[0]["chat_id"] == chat["id"]
    assert rows[0]["read"] is False
    assert "New inbox item" in rows[0]["body"]


def test_admin_reply_creates_notification_for_chat_owner(
    chat_client,
    normal_user,
    admin_user,
):
    chat = create_chat(chat_client, normal_user).json()
    join = chat_client.post(
        f"/api/chats/{chat['id']}/join",
        headers=auth_headers(admin_user),
    )
    assert join.status_code == 200

    reply = chat_client.post(
        f"/api/chats/{chat['id']}/messages",
        json={"message": "I am checking it now"},
        headers=auth_headers(admin_user),
    )
    assert reply.status_code == 201

    resp = chat_client.get("/api/notifications", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    rows = resp.json()
    assert len(rows) == 1
    assert rows[0]["chat_id"] == chat["id"]
    assert "I am checking it now" in rows[0]["body"]


def test_notification_unread_count_and_mark_read(
    chat_client,
    normal_user,
    admin_user,
):
    create_chat(chat_client, normal_user)

    count = chat_client.get(
        "/api/notifications/unread-count",
        headers=auth_headers(admin_user),
    )
    assert count.status_code == 200
    assert count.json() == {"count": 1}

    notification = chat_client.get(
        "/api/notifications",
        headers=auth_headers(admin_user),
    ).json()[0]
    marked = chat_client.post(
        f"/api/notifications/{notification['id']}/read",
        headers=auth_headers(admin_user),
    )
    assert marked.status_code == 200
    assert marked.json()["read"] is True

    count = chat_client.get(
        "/api/notifications/unread-count",
        headers=auth_headers(admin_user),
    )
    assert count.json() == {"count": 0}


def test_user_cannot_read_another_users_notification(
    chat_client,
    db_session,
    normal_user,
    other_user,
):
    row = Notification(
        user_id=normal_user.id,
        type="chat_message",
        title="Private",
        body="Only for the owner",
        chat_id=None,
        read=False,
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)

    resp = chat_client.post(
        f"/api/notifications/{row.id}/read",
        headers=auth_headers(other_user),
    )
    # Deliberately return 404 to avoid leaking notification ownership.
    assert resp.status_code == 404


def test_mark_all_notifications_read(
    chat_client,
    db_session,
    normal_user,
):
    db_session.add_all(
        [
            Notification(
                user_id=normal_user.id,
                type="chat_message",
                title="One",
                body="First",
                read=False,
            ),
            Notification(
                user_id=normal_user.id,
                type="chat_message",
                title="Two",
                body="Second",
                read=False,
            ),
        ]
    )
    db_session.commit()

    resp = chat_client.post(
        "/api/notifications/read-all",
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 200
    assert resp.json() == {"count": 0}

    rows = chat_client.get(
        "/api/notifications",
        headers=auth_headers(normal_user),
    ).json()
    assert all(item["read"] for item in rows)
