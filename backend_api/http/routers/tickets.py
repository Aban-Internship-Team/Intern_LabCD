"""User and admin routes for support tickets."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user, require_admin
from backend_api.http.schemas.tickets import (
    TicketAssign,
    TicketCreate,
    TicketListItem,
    TicketMessageCreate,
    TicketMessageOut,
    TicketOut,
    TicketStatusUpdate,
    TicketUpdate,
)
from backend_api.http.services import ticket_service

router = APIRouter(tags=["tickets"])

STATUS_FILTER = "^(open|in_progress|waiting_for_user|resolved|closed|all)$"
PRIORITY_FILTER = "^(low|medium|high|urgent|all)$"
CATEGORY_FILTER = "^(general|billing|technical|account|other|all)$"


def _get_or_404(db: Session, ticket_id: int):
    ticket = ticket_service.get_ticket(db, ticket_id)
    if ticket is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return ticket


def _require_access(user: User, ticket) -> None:
    if not ticket_service.can_access_ticket(user, ticket):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")


@router.post("/tickets", response_model=TicketOut, status_code=status.HTTP_201_CREATED)
def create_ticket(
    body: TicketCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketOut:
    try:
        ticket = ticket_service.create_ticket(
            db,
            user,
            title=body.title,
            description=body.description,
            category=body.category,
            priority=body.priority,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TicketOut.model_validate(ticket_service.to_out(ticket))


@router.get("/tickets", response_model=list[TicketListItem])
def list_tickets(
    response: Response,
    ticket_status: str | None = Query(None, alias="status", pattern=STATUS_FILTER),
    priority: str | None = Query(None, pattern=PRIORITY_FILTER),
    category: str | None = Query(None, pattern=CATEGORY_FILTER),
    page: int | None = Query(None, ge=1, description="1-indexed page number"),
    page_size: int | None = Query(None, ge=1, le=200, description="Rows per page (max 200)"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketListItem]:
    # Pagination is opt-in: pass `page` and/or `page_size` to receive a
    # page of results. Omit both to get every matching ticket, exactly as
    # before this endpoint supported pagination.
    rows, total = ticket_service.list_tickets(
        db,
        user,
        status=ticket_status,
        priority=priority,
        category=category,
        page=page,
        page_size=page_size,
    )
    response.headers["X-Total-Count"] = str(total)
    return [TicketListItem.model_validate(ticket_service.to_list_item(row)) for row in rows]


@router.get("/tickets/{ticket_id}", response_model=TicketOut)
def get_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketOut:
    ticket = _get_or_404(db, ticket_id)
    _require_access(user, ticket)
    return TicketOut.model_validate(ticket_service.to_out(ticket))


@router.patch("/tickets/{ticket_id}", response_model=TicketOut)
def update_ticket(
    ticket_id: int,
    body: TicketUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketOut:
    ticket = _get_or_404(db, ticket_id)
    _require_access(user, ticket)

    fields_set = body.model_fields_set
    wants_admin_fields = ("status" in fields_set) or ("assigned_to" in fields_set)
    if wants_admin_fields and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can change status or assignee",
        )
    if not user.is_admin and ticket.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if not user.is_admin and ticket.status not in {"open", "waiting_for_user"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only open or waiting_for_user tickets can be edited by the owner",
        )

    try:
        updated = ticket_service.update_ticket(
            db,
            ticket,
            title=body.title,
            description=body.description,
            category=body.category,
            priority=body.priority,
            status=body.status if user.is_admin else None,
            assigned_to=body.assigned_to if user.is_admin and "assigned_to" in fields_set else None,
            clear_assignee=user.is_admin
            and "assigned_to" in fields_set
            and body.assigned_to is None,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TicketOut.model_validate(ticket_service.to_out(updated))


@router.patch("/tickets/{ticket_id}/status", response_model=TicketOut)
def update_ticket_status(
    ticket_id: int,
    body: TicketStatusUpdate,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TicketOut:
    ticket = _get_or_404(db, ticket_id)
    try:
        updated = ticket_service.update_ticket(db, ticket, status=body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TicketOut.model_validate(ticket_service.to_out(updated))


@router.post("/tickets/{ticket_id}/assign", response_model=TicketOut)
def assign_ticket(
    ticket_id: int,
    body: TicketAssign,
    _: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> TicketOut:
    ticket = _get_or_404(db, ticket_id)
    try:
        updated = ticket_service.assign_ticket(db, ticket, assigned_to=body.assigned_to)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TicketOut.model_validate(ticket_service.to_out(updated))


@router.patch("/tickets/{ticket_id}/close", response_model=TicketOut)
def close_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketOut:
    ticket = _get_or_404(db, ticket_id)
    _require_access(user, ticket)
    updated = ticket_service.close_ticket(db, ticket, status="closed")
    return TicketOut.model_validate(ticket_service.to_out(updated))


@router.delete("/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    ticket = _get_or_404(db, ticket_id)
    if not user.is_admin and ticket.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if not user.is_admin and ticket.status != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only open tickets can be deleted by the owner",
        )
    ticket_service.delete_ticket(db, ticket)


@router.get("/tickets/{ticket_id}/messages", response_model=list[TicketMessageOut])
def list_ticket_messages(
    ticket_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[TicketMessageOut]:
    ticket = _get_or_404(db, ticket_id)
    _require_access(user, ticket)
    messages = ticket_service.list_messages(db, ticket_id)
    return [
        TicketMessageOut.model_validate(ticket_service.message_to_out(message))
        for message in messages
    ]


@router.post(
    "/tickets/{ticket_id}/messages",
    response_model=TicketMessageOut,
    status_code=status.HTTP_201_CREATED,
)
def create_ticket_message(
    ticket_id: int,
    body: TicketMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> TicketMessageOut:
    ticket = _get_or_404(db, ticket_id)
    _require_access(user, ticket)
    try:
        message = ticket_service.add_message(db, ticket, user, message=body.message)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return TicketMessageOut.model_validate(ticket_service.message_to_out(message))
