"""Pydantic schemas for support tickets and ticket messages."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

TICKET_STATUS_PATTERN = "^(open|in_progress|waiting_for_user|resolved|closed)$"
TICKET_PRIORITY_PATTERN = "^(low|medium|high|urgent)$"
TICKET_CATEGORY_PATTERN = "^(general|billing|technical|account|other)$"


class TicketMessageOut(BaseModel):
    id: int
    ticket_id: int
    sender_id: int
    sender_email: str | None = None
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TicketMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


class TicketOut(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    assigned_to: int | None
    assignee_email: str | None = None
    title: str
    description: str
    category: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None
    messages: list[TicketMessageOut] = []

    model_config = {"from_attributes": True}


class TicketListItem(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    assigned_to: int | None
    assignee_email: str | None = None
    title: str
    description: str
    category: str
    priority: str
    status: str
    created_at: datetime
    updated_at: datetime
    closed_at: datetime | None

    model_config = {"from_attributes": True}


class TicketCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: str = Field(..., min_length=1, max_length=8000)
    category: str = Field("general", pattern=TICKET_CATEGORY_PATTERN)
    priority: str = Field("medium", pattern=TICKET_PRIORITY_PATTERN)


class TicketUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = Field(None, min_length=1, max_length=8000)
    category: str | None = Field(None, pattern=TICKET_CATEGORY_PATTERN)
    priority: str | None = Field(None, pattern=TICKET_PRIORITY_PATTERN)
    status: str | None = Field(None, pattern=TICKET_STATUS_PATTERN)
    assigned_to: int | None = None


class TicketStatusUpdate(BaseModel):
    status: str = Field(..., pattern=TICKET_STATUS_PATTERN)


class TicketAssign(BaseModel):
    assigned_to: int | None = None
