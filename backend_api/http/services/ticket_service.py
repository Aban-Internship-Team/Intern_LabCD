"""CRUD, assignment, and messaging for support tickets."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import Ticket, TicketMessage, User

VALID_STATUSES = {
    "open",
    "in_progress",
    "waiting_for_user",
    "resolved",
    "closed",
}
VALID_PRIORITIES = {"low", "medium", "high", "urgent"}
VALID_CATEGORIES = {"general", "billing", "technical", "account", "other"}
CLOSED_LIKE = {"resolved", "closed"}


def message_to_out(message: TicketMessage) -> dict:
    return {
        "id": message.id,
        "ticket_id": message.ticket_id,
        "sender_id": message.sender_id,
        "sender_email": message.sender.email if message.sender is not None else None,
        "message": message.message,
        "created_at": message.created_at,
    }


def to_list_item(ticket: Ticket) -> dict:
    return {
        "id": ticket.id,
        "user_id": ticket.user_id,
        "user_email": ticket.user.email if ticket.user is not None else None,
        "assigned_to": ticket.assigned_to,
        "assignee_email": ticket.assignee.email if ticket.assignee is not None else None,
        "title": ticket.title,
        "description": ticket.description,
        "category": ticket.category,
        "priority": ticket.priority,
        "status": ticket.status,
        "created_at": ticket.created_at,
        "updated_at": ticket.updated_at,
        "closed_at": ticket.closed_at,
    }


def to_out(ticket: Ticket, *, include_messages: bool = True) -> dict:
    payload = to_list_item(ticket)
    if include_messages:
        messages = ticket.messages or []
        payload["messages"] = [message_to_out(m) for m in messages]
    else:
        payload["messages"] = []
    return payload


def can_access_ticket(user: User, ticket: Ticket) -> bool:
    if user.is_admin:
        return True
    return ticket.user_id == user.id


def create_ticket(
    db: Session,
    user: User,
    *,
    title: str,
    description: str,
    category: str = "general",
    priority: str = "medium",
) -> Ticket:
    if category not in VALID_CATEGORIES:
        raise ValueError(f"Invalid category: {category}")
    if priority not in VALID_PRIORITIES:
        raise ValueError(f"Invalid priority: {priority}")

    now = datetime.now(timezone.utc)
    ticket = Ticket(
        user_id=user.id,
        assigned_to=None,
        title=title.strip(),
        description=description.strip(),
        category=category,
        priority=priority,
        status="open",
        created_at=now,
        updated_at=now,
        closed_at=None,
    )
    db.add(ticket)
    db.commit()
    return get_ticket(db, ticket.id)  # type: ignore[return-value]


DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200


def list_tickets(
    db: Session,
    user: User,
    *,
    status: str | None = None,
    priority: str | None = None,
    category: str | None = None,
    page: int | None = None,
    page_size: int | None = None,
) -> tuple[list[Ticket], int]:
    """List tickets visible to ``user``, optionally paginated.

    When ``page``/``page_size`` are both omitted, every matching row is
    returned (this preserves the previous, non-paginated behavior for
    existing callers). Passing either one turns pagination on. The total
    count of matching rows (ignoring page/page_size) is always returned
    alongside the page of results so callers can render page controls or
    a total badge without a second round trip.
    """
    query = db.query(Ticket).options(
        joinedload(Ticket.user),
        joinedload(Ticket.assignee),
    )
    if not user.is_admin:
        query = query.filter(Ticket.user_id == user.id)
    if status and status != "all":
        query = query.filter(Ticket.status == status)
    if priority and priority != "all":
        query = query.filter(Ticket.priority == priority)
    if category and category != "all":
        query = query.filter(Ticket.category == category)

    total = query.order_by(None).count()

    query = query.order_by(Ticket.created_at.desc())
    if page is not None or page_size is not None:
        safe_page = max(page or 1, 1)
        safe_page_size = min(max(page_size or DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
        query = query.offset((safe_page - 1) * safe_page_size).limit(safe_page_size)

    return query.all(), total


def get_ticket(db: Session, ticket_id: int) -> Ticket | None:
    return (
        db.query(Ticket)
        .options(
            joinedload(Ticket.user),
            joinedload(Ticket.assignee),
            joinedload(Ticket.messages).joinedload(TicketMessage.sender),
        )
        .filter(Ticket.id == ticket_id)
        .first()
    )


def _apply_status(ticket: Ticket, status: str, *, now: datetime) -> None:
    if status not in VALID_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    ticket.status = status
    if status in CLOSED_LIKE:
        ticket.closed_at = now
    else:
        ticket.closed_at = None


def update_ticket(
    db: Session,
    ticket: Ticket,
    *,
    title: str | None = None,
    description: str | None = None,
    category: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    assigned_to: int | None = None,
    clear_assignee: bool = False,
) -> Ticket:
    now = datetime.now(timezone.utc)
    if title is not None:
        ticket.title = title.strip()
    if description is not None:
        ticket.description = description.strip()
    if category is not None:
        if category not in VALID_CATEGORIES:
            raise ValueError(f"Invalid category: {category}")
        ticket.category = category
    if priority is not None:
        if priority not in VALID_PRIORITIES:
            raise ValueError(f"Invalid priority: {priority}")
        ticket.priority = priority
    if status is not None:
        _apply_status(ticket, status, now=now)
    if clear_assignee:
        ticket.assigned_to = None
    elif assigned_to is not None:
        assignee = db.query(User).filter(User.id == assigned_to).first()
        if assignee is None:
            raise ValueError("Assignee not found")
        ticket.assigned_to = assigned_to
    ticket.updated_at = now
    db.commit()
    return get_ticket(db, ticket.id)  # type: ignore[return-value]


def close_ticket(db: Session, ticket: Ticket, *, status: str = "closed") -> Ticket:
    if status not in CLOSED_LIKE:
        raise ValueError("Close status must be resolved or closed")
    return update_ticket(db, ticket, status=status)


def assign_ticket(
    db: Session,
    ticket: Ticket,
    *,
    assigned_to: int | None,
) -> Ticket:
    return update_ticket(
        db,
        ticket,
        assigned_to=assigned_to,
        clear_assignee=assigned_to is None,
    )


def delete_ticket(db: Session, ticket: Ticket) -> None:
    db.delete(ticket)
    db.commit()


def list_messages(db: Session, ticket_id: int) -> list[TicketMessage]:
    return (
        db.query(TicketMessage)
        .options(joinedload(TicketMessage.sender))
        .filter(TicketMessage.ticket_id == ticket_id)
        .order_by(TicketMessage.created_at.asc())
        .all()
    )


def add_message(
    db: Session,
    ticket: Ticket,
    sender: User,
    *,
    message: str,
) -> TicketMessage:
    if ticket.status == "closed":
        raise ValueError("Cannot message a closed ticket")

    text = message.strip()
    if not text:
        raise ValueError("Message is required")

    now = datetime.now(timezone.utc)
    row = TicketMessage(
        ticket_id=ticket.id,
        sender_id=sender.id,
        message=text,
        created_at=now,
    )
    ticket.updated_at = now
    if sender.is_admin and ticket.status == "open":
        ticket.status = "in_progress"
        if ticket.assigned_to is None:
            ticket.assigned_to = sender.id
    elif not sender.is_admin and ticket.status == "waiting_for_user":
        ticket.status = "in_progress"

    db.add(row)
    db.commit()
    loaded = (
        db.query(TicketMessage)
        .options(joinedload(TicketMessage.sender))
        .filter(TicketMessage.id == row.id)
        .first()
    )
    return loaded  # type: ignore[return-value]
