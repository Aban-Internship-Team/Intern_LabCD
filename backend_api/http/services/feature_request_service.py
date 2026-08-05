"""CRUD, voting, and comments for feature requests."""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import Session, joinedload

from backend_api.db.models import (
    FeatureRequest,
    FeatureRequestComment,
    FeatureRequestVote,
    User,
)

VALID_STATUSES = {
    "submitted",
    "under_review",
    "planned",
    "in_progress",
    "completed",
    "rejected",
}


def _user_vote_ids(db: Session, user_id: int, request_ids: list[int]) -> set[int]:
    if not request_ids:
        return set()
    rows = (
        db.query(FeatureRequestVote.feature_request_id)
        .filter(
            FeatureRequestVote.user_id == user_id,
            FeatureRequestVote.feature_request_id.in_(request_ids),
        )
        .all()
    )
    return {row[0] for row in rows}


def comment_to_out(comment: FeatureRequestComment) -> dict:
    return {
        "id": comment.id,
        "feature_request_id": comment.feature_request_id,
        "user_id": comment.user_id,
        "user_email": comment.user.email if comment.user is not None else None,
        "comment": comment.comment,
        "created_at": comment.created_at,
    }


def to_list_item(
    row: FeatureRequest,
    *,
    has_voted: bool = False,
) -> dict:
    return {
        "id": row.id,
        "user_id": row.user_id,
        "user_email": row.user.email if row.user is not None else None,
        "title": row.title,
        "description": row.description,
        "status": row.status,
        "vote_count": row.vote_count,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
        "has_voted": has_voted,
    }


def to_out(
    row: FeatureRequest,
    *,
    has_voted: bool = False,
    include_comments: bool = True,
) -> dict:
    payload = to_list_item(row, has_voted=has_voted)
    if include_comments:
        comments = row.comments or []
        payload["comments"] = [comment_to_out(c) for c in comments]
    else:
        payload["comments"] = []
    return payload


def create_request(
    db: Session,
    user: User,
    *,
    title: str,
    description: str,
) -> FeatureRequest:
    now = datetime.now(timezone.utc)
    row = FeatureRequest(
        user_id=user.id,
        title=title.strip(),
        description=description.strip(),
        status="submitted",
        vote_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    db.commit()
    return get_request(db, row.id)  # type: ignore[return-value]


def list_requests(
    db: Session,
    *,
    status: str | None = None,
    viewer: User | None = None,
) -> list[tuple[FeatureRequest, bool]]:
    query = db.query(FeatureRequest).options(joinedload(FeatureRequest.user))
    if status and status != "all":
        query = query.filter(FeatureRequest.status == status)
    rows = query.order_by(
        FeatureRequest.vote_count.desc(),
        FeatureRequest.created_at.desc(),
    ).all()

    voted: set[int] = set()
    if viewer is not None:
        voted = _user_vote_ids(db, viewer.id, [r.id for r in rows])
    return [(row, row.id in voted) for row in rows]


def get_request(db: Session, request_id: int) -> FeatureRequest | None:
    return (
        db.query(FeatureRequest)
        .options(
            joinedload(FeatureRequest.user),
            joinedload(FeatureRequest.comments).joinedload(FeatureRequestComment.user),
        )
        .filter(FeatureRequest.id == request_id)
        .first()
    )


def has_user_voted(db: Session, request_id: int, user_id: int) -> bool:
    return (
        db.query(FeatureRequestVote.id)
        .filter(
            FeatureRequestVote.feature_request_id == request_id,
            FeatureRequestVote.user_id == user_id,
        )
        .first()
        is not None
    )


def update_request(
    db: Session,
    row: FeatureRequest,
    *,
    title: str | None = None,
    description: str | None = None,
    status: str | None = None,
) -> FeatureRequest:
    if title is not None:
        row.title = title.strip()
    if description is not None:
        row.description = description.strip()
    if status is not None:
        if status not in VALID_STATUSES:
            raise ValueError(f"Invalid status: {status}")
        row.status = status
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_request(db, row.id)  # type: ignore[return-value]


def delete_request(db: Session, row: FeatureRequest) -> None:
    db.delete(row)
    db.commit()


def add_vote(db: Session, row: FeatureRequest, user: User) -> FeatureRequestVote:
    existing = (
        db.query(FeatureRequestVote)
        .filter(
            FeatureRequestVote.feature_request_id == row.id,
            FeatureRequestVote.user_id == user.id,
        )
        .first()
    )
    if existing is not None:
        raise ValueError("Already voted")

    vote = FeatureRequestVote(
        feature_request_id=row.id,
        user_id=user.id,
        created_at=datetime.now(timezone.utc),
    )
    row.vote_count = int(row.vote_count or 0) + 1
    row.updated_at = datetime.now(timezone.utc)
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


def remove_vote(db: Session, row: FeatureRequest, user: User) -> None:
    vote = (
        db.query(FeatureRequestVote)
        .filter(
            FeatureRequestVote.feature_request_id == row.id,
            FeatureRequestVote.user_id == user.id,
        )
        .first()
    )
    if vote is None:
        raise ValueError("Vote not found")

    db.delete(vote)
    row.vote_count = max(0, int(row.vote_count or 0) - 1)
    row.updated_at = datetime.now(timezone.utc)
    db.commit()


def list_comments(db: Session, request_id: int) -> list[FeatureRequestComment]:
    return (
        db.query(FeatureRequestComment)
        .options(joinedload(FeatureRequestComment.user))
        .filter(FeatureRequestComment.feature_request_id == request_id)
        .order_by(FeatureRequestComment.created_at.asc())
        .all()
    )


def add_comment(
    db: Session,
    row: FeatureRequest,
    user: User,
    *,
    comment: str,
) -> FeatureRequestComment:
    text = comment.strip()
    if not text:
        raise ValueError("Comment is required")

    entry = FeatureRequestComment(
        feature_request_id=row.id,
        user_id=user.id,
        comment=text,
        created_at=datetime.now(timezone.utc),
    )
    row.updated_at = datetime.now(timezone.utc)
    db.add(entry)
    db.commit()
    loaded = (
        db.query(FeatureRequestComment)
        .options(joinedload(FeatureRequestComment.user))
        .filter(FeatureRequestComment.id == entry.id)
        .first()
    )
    return loaded  # type: ignore[return-value]


def vote_to_out(vote: FeatureRequestVote, *, vote_count: int) -> dict:
    return {
        "id": vote.id,
        "feature_request_id": vote.feature_request_id,
        "user_id": vote.user_id,
        "created_at": vote.created_at,
        "vote_count": vote_count,
    }
