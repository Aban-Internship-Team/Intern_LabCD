"""Tests for the support-ticket API: CRUD, permissions, filters, and messages."""

from __future__ import annotations

from backend_api.tests.conftest import auth_headers


def create_ticket(client, user, **overrides):
    body = {
        "title": "My printer is on fire",
        "description": "Smoke is coming out of the printer.",
        "category": "technical",
        "priority": "high",
    }
    body.update(overrides)
    return client.post("/api/tickets", json=body, headers=auth_headers(user))


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


def test_list_tickets_requires_auth(client):
    resp = client.get("/api/tickets")
    assert resp.status_code == 401


def test_invalid_token_is_rejected(client):
    resp = client.get("/api/tickets", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Create
# ---------------------------------------------------------------------------


def test_create_ticket_success(client, normal_user):
    resp = create_ticket(client, normal_user)
    assert resp.status_code == 201
    data = resp.json()
    assert data["title"] == "My printer is on fire"
    assert data["status"] == "open"
    assert data["user_id"] == normal_user.id
    assert data["assigned_to"] is None
    assert data["messages"] == []


def test_create_ticket_defaults_category_and_priority(client, normal_user):
    resp = client.post(
        "/api/tickets",
        json={"title": "Question", "description": "How do I reset my password?"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["category"] == "general"
    assert data["priority"] == "medium"


def test_create_ticket_rejects_invalid_priority(client, normal_user):
    resp = create_ticket(client, normal_user, priority="super-urgent")
    assert resp.status_code == 422


def test_create_ticket_requires_title_and_description(client, normal_user):
    resp = client.post(
        "/api/tickets",
        json={"title": "", "description": ""},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# List + filters + visibility
# ---------------------------------------------------------------------------


def test_normal_user_only_sees_own_tickets(client, normal_user, other_user):
    create_ticket(client, normal_user, title="Mine")
    create_ticket(client, other_user, title="Not mine")

    resp = client.get("/api/tickets", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    titles = [t["title"] for t in resp.json()]
    assert titles == ["Mine"]


def test_admin_sees_all_tickets(client, normal_user, other_user, admin_user):
    create_ticket(client, normal_user, title="From user")
    create_ticket(client, other_user, title="From other")

    resp = client.get("/api/tickets", headers=auth_headers(admin_user))
    assert resp.status_code == 200
    titles = {t["title"] for t in resp.json()}
    assert titles == {"From user", "From other"}


def test_list_tickets_filters_by_status_priority_category(client, normal_user, admin_user):
    t1 = create_ticket(client, normal_user, title="Low general", priority="low", category="general").json()
    create_ticket(client, normal_user, title="Urgent billing", priority="urgent", category="billing")

    # Close t1 so status filter has something to distinguish.
    client.patch(f"/api/tickets/{t1['id']}/close", headers=auth_headers(normal_user))

    resp = client.get("/api/tickets?priority=urgent", headers=auth_headers(admin_user))
    assert [t["title"] for t in resp.json()] == ["Urgent billing"]

    resp = client.get("/api/tickets?category=general", headers=auth_headers(admin_user))
    assert [t["title"] for t in resp.json()] == ["Low general"]

    resp = client.get("/api/tickets?status=closed", headers=auth_headers(admin_user))
    assert [t["title"] for t in resp.json()] == ["Low general"]


def test_list_tickets_rejects_invalid_filter_value(client, normal_user):
    resp = client.get("/api/tickets?status=not-a-status", headers=auth_headers(normal_user))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Pagination (opt-in via page / page_size)
# ---------------------------------------------------------------------------


def test_list_tickets_without_paging_params_returns_everything(client, normal_user):
    for i in range(5):
        create_ticket(client, normal_user, title=f"Ticket {i}")

    resp = client.get("/api/tickets", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert len(resp.json()) == 5
    assert resp.headers["X-Total-Count"] == "5"


def test_list_tickets_paginates_when_page_size_given(client, normal_user):
    for i in range(5):
        create_ticket(client, normal_user, title=f"Ticket {i}")

    resp = client.get("/api/tickets?page_size=2", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert len(resp.json()) == 2
    assert resp.headers["X-Total-Count"] == "5"


def test_list_tickets_second_page_returns_remaining_rows_newest_first(client, normal_user):
    # Tickets are created oldest -> newest and returned newest-first, so
    # with page_size=2 page 1 is [4,3], page 2 is [2,1], page 3 is [0].
    for i in range(5):
        create_ticket(client, normal_user, title=f"Ticket {i}")

    page1 = client.get("/api/tickets?page=1&page_size=2", headers=auth_headers(normal_user)).json()
    page2 = client.get("/api/tickets?page=2&page_size=2", headers=auth_headers(normal_user)).json()
    page3 = client.get("/api/tickets?page=3&page_size=2", headers=auth_headers(normal_user)).json()

    assert [t["title"] for t in page1] == ["Ticket 4", "Ticket 3"]
    assert [t["title"] for t in page2] == ["Ticket 2", "Ticket 1"]
    assert [t["title"] for t in page3] == ["Ticket 0"]


def test_list_tickets_page_beyond_range_returns_empty_list(client, normal_user):
    create_ticket(client, normal_user, title="Only ticket")

    resp = client.get("/api/tickets?page=5&page_size=10", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert resp.json() == []
    assert resp.headers["X-Total-Count"] == "1"


def test_list_tickets_pagination_respects_filters_and_visibility(
    client, normal_user, other_user, admin_user
):
    for i in range(3):
        create_ticket(client, normal_user, title=f"Mine {i}", priority="urgent")
    create_ticket(client, other_user, title="Not mine", priority="urgent")

    # Normal user: only their own urgent tickets are counted/paged.
    resp = client.get(
        "/api/tickets?priority=urgent&page=1&page_size=2", headers=auth_headers(normal_user)
    )
    assert resp.headers["X-Total-Count"] == "3"
    assert len(resp.json()) == 2

    # Admin sees everyone's urgent tickets.
    resp = client.get(
        "/api/tickets?priority=urgent&page=1&page_size=2", headers=auth_headers(admin_user)
    )
    assert resp.headers["X-Total-Count"] == "4"
    assert len(resp.json()) == 2


def test_list_tickets_rejects_invalid_paging_params(client, normal_user):
    resp = client.get("/api/tickets?page=0", headers=auth_headers(normal_user))
    assert resp.status_code == 422

    resp = client.get("/api/tickets?page_size=0", headers=auth_headers(normal_user))
    assert resp.status_code == 422

    resp = client.get("/api/tickets?page_size=201", headers=auth_headers(normal_user))
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Get single ticket
# ---------------------------------------------------------------------------


def test_get_ticket_not_found(client, normal_user):
    resp = client.get("/api/tickets/999999", headers=auth_headers(normal_user))
    assert resp.status_code == 404


def test_owner_can_view_own_ticket(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.get(f"/api/tickets/{ticket['id']}", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert resp.json()["id"] == ticket["id"]


def test_other_user_cannot_view_ticket(client, normal_user, other_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.get(f"/api/tickets/{ticket['id']}", headers=auth_headers(other_user))
    assert resp.status_code == 403


def test_admin_can_view_any_ticket(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.get(f"/api/tickets/{ticket['id']}", headers=auth_headers(admin_user))
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Update
# ---------------------------------------------------------------------------


def test_owner_can_edit_open_ticket(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"title": "Updated title"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 200
    assert resp.json()["title"] == "Updated title"


def test_owner_cannot_change_status_or_assignee(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"status": "resolved"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 403

    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"assigned_to": admin_user.id},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 403


def test_owner_cannot_edit_resolved_ticket(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"status": "resolved"},
        headers=auth_headers(admin_user),
    )
    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"title": "Trying to edit"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 400


def test_other_user_cannot_edit_ticket(client, normal_user, other_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"title": "Hijack"},
        headers=auth_headers(other_user),
    )
    assert resp.status_code == 403


def test_admin_can_change_status_and_assignee(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}",
        json={"status": "in_progress", "assigned_to": admin_user.id},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "in_progress"
    assert data["assigned_to"] == admin_user.id


# ---------------------------------------------------------------------------
# Dedicated status / assign endpoints (admin only)
# ---------------------------------------------------------------------------


def test_update_status_endpoint_requires_admin(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}/status",
        json={"status": "resolved"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 403


def test_update_status_endpoint_sets_closed_at_for_resolved(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(
        f"/api/tickets/{ticket['id']}/status",
        json={"status": "resolved"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "resolved"
    assert data["closed_at"] is not None


def test_assign_endpoint_requires_admin(client, normal_user, other_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.post(
        f"/api/tickets/{ticket['id']}/assign",
        json={"assigned_to": other_user.id},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 403


def test_assign_endpoint_rejects_unknown_user(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.post(
        f"/api/tickets/{ticket['id']}/assign",
        json={"assigned_to": 999999},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 400


def test_assign_endpoint_can_clear_assignee(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    client.post(
        f"/api/tickets/{ticket['id']}/assign",
        json={"assigned_to": admin_user.id},
        headers=auth_headers(admin_user),
    )
    resp = client.post(
        f"/api/tickets/{ticket['id']}/assign",
        json={"assigned_to": None},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200
    assert resp.json()["assigned_to"] is None


# ---------------------------------------------------------------------------
# Close / delete
# ---------------------------------------------------------------------------


def test_owner_can_close_own_ticket(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(f"/api/tickets/{ticket['id']}/close", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "closed"
    assert data["closed_at"] is not None


def test_other_user_cannot_close_ticket(client, normal_user, other_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.patch(f"/api/tickets/{ticket['id']}/close", headers=auth_headers(other_user))
    assert resp.status_code == 403


def test_owner_can_delete_open_ticket(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.delete(f"/api/tickets/{ticket['id']}", headers=auth_headers(normal_user))
    assert resp.status_code == 204

    resp = client.get(f"/api/tickets/{ticket['id']}", headers=auth_headers(normal_user))
    assert resp.status_code == 404


def test_owner_cannot_delete_non_open_ticket(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    client.patch(
        f"/api/tickets/{ticket['id']}/status",
        json={"status": "in_progress"},
        headers=auth_headers(admin_user),
    )
    resp = client.delete(f"/api/tickets/{ticket['id']}", headers=auth_headers(normal_user))
    assert resp.status_code == 400


def test_admin_can_delete_any_ticket_regardless_of_status(client, normal_user, admin_user):
    ticket = create_ticket(client, normal_user).json()
    client.patch(
        f"/api/tickets/{ticket['id']}/status",
        json={"status": "in_progress"},
        headers=auth_headers(admin_user),
    )
    resp = client.delete(f"/api/tickets/{ticket['id']}", headers=auth_headers(admin_user))
    assert resp.status_code == 204


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def test_new_ticket_has_no_messages(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.get(f"/api/tickets/{ticket['id']}/messages", headers=auth_headers(normal_user))
    assert resp.status_code == 200
    assert resp.json() == []


def test_owner_can_post_message(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.post(
        f"/api/tickets/{ticket['id']}/messages",
        json={"message": "Any update?"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["message"] == "Any update?"
    assert data["sender_id"] == normal_user.id


def test_stranger_cannot_post_message(client, normal_user, other_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.post(
        f"/api/tickets/{ticket['id']}/messages",
        json={"message": "I shouldn't be able to do this"},
        headers=auth_headers(other_user),
    )
    assert resp.status_code == 403


def test_admin_reply_moves_open_ticket_to_in_progress_and_assigns(
    client, normal_user, admin_user
):
    ticket = create_ticket(client, normal_user).json()
    assert ticket["status"] == "open"
    assert ticket["assigned_to"] is None

    resp = client.post(
        f"/api/tickets/{ticket['id']}/messages",
        json={"message": "Looking into it."},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201

    refreshed = client.get(
        f"/api/tickets/{ticket['id']}", headers=auth_headers(admin_user)
    ).json()
    assert refreshed["status"] == "in_progress"
    assert refreshed["assigned_to"] == admin_user.id
    assert len(refreshed["messages"]) == 1


def test_cannot_message_a_closed_ticket(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    client.patch(f"/api/tickets/{ticket['id']}/close", headers=auth_headers(normal_user))

    resp = client.post(
        f"/api/tickets/{ticket['id']}/messages",
        json={"message": "Still there?"},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 400


def test_empty_message_is_rejected(client, normal_user):
    ticket = create_ticket(client, normal_user).json()
    resp = client.post(
        f"/api/tickets/{ticket['id']}/messages",
        json={"message": ""},
        headers=auth_headers(normal_user),
    )
    assert resp.status_code == 422
