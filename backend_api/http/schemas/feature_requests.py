"""Pydantic schemas for feature requests, votes, and comments."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

FEATURE_REQUEST_STATUS_PATTERN = (
    "^(submitted|under_review|planned|in_progress|completed|rejected)$"
)


class FeatureRequestCommentOut(BaseModel):
    id: int
    feature_request_id: int
    user_id: int
    user_email: str | None = None
    comment: str
    created_at: datetime

    model_config = {"from_attributes": True}


class FeatureRequestCommentCreate(BaseModel):
    comment: str = Field(..., min_length=1, max_length=8000)


class FeatureRequestOut(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    title: str
    description: str
    status: str
    vote_count: int
    created_at: datetime
    updated_at: datetime
    has_voted: bool = False
    comments: list[FeatureRequestCommentOut] = []

    model_config = {"from_attributes": True}


class FeatureRequestListItem(BaseModel):
    id: int
    user_id: int
    user_email: str | None = None
    title: str
    description: str
    status: str
    vote_count: int
    created_at: datetime
    updated_at: datetime
    has_voted: bool = False

    model_config = {"from_attributes": True}


class FeatureRequestCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=300)
    description: str = Field(..., min_length=1, max_length=8000)


class FeatureRequestUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    description: str | None = Field(None, min_length=1, max_length=8000)
    status: str | None = Field(None, pattern=FEATURE_REQUEST_STATUS_PATTERN)


class FeatureRequestStatusUpdate(BaseModel):
    status: str = Field(..., pattern=FEATURE_REQUEST_STATUS_PATTERN)


class FeatureRequestVoteOut(BaseModel):
    id: int
    feature_request_id: int
    user_id: int
    created_at: datetime
    vote_count: int

    model_config = {"from_attributes": True}
