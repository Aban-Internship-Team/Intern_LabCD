"""Pydantic schemas for live chat sessions and messages."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class ChatMessageOut(BaseModel):
    id: int
    chat_session_id: int
    sender_id: int
    sender_email: str | None = None
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatMessageCreate(BaseModel):
    message: str = Field(..., min_length=1, max_length=8000)


class ChatSessionOut(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    agent_id: int | None
    agent_email: str | None = None
    status: str
    created_at: datetime
    closed_at: datetime | None
    messages: list[ChatMessageOut] = []

    model_config = {"from_attributes": True}


class ChatSessionListItem(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    agent_id: int | None
    agent_email: str | None = None
    status: str
    created_at: datetime
    closed_at: datetime | None
    unread_count: int = 0
    last_message_preview: str | None = None
    last_message_at: datetime | None = None
    peer_online: bool = False

    model_config = {"from_attributes": True}


class ChatSessionCreate(BaseModel):
    """Optional first message when opening a session."""

    message: str | None = Field(None, min_length=1, max_length=8000)


class ChatReadOut(BaseModel):
    chat_id: int
    unread_count: int = 0
