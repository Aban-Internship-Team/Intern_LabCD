"""User and admin routes for feature requests."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from backend_api.db.models import User
from backend_api.db.session import get_db
from backend_api.http.dependencies import get_current_user, require_admin
from backend_api.http.schemas.feature_requests import (
    FeatureRequestCommentCreate,
    FeatureRequestCommentOut,
    FeatureRequestCreate,
    FeatureRequestListItem,
    FeatureRequestOut,
    FeatureRequestStatusUpdate,
    FeatureRequestUpdate,
    FeatureRequestVoteOut,
)
from backend_api.http.services import feature_request_service

router = APIRouter(tags=["feature-requests"])

STATUS_FILTER_PATTERN = (
    "^(submitted|under_review|planned|in_progress|completed|rejected|all)$"
)


def _get_or_404(db: Session, request_id: int):
    row = feature_request_service.get_request(db, request_id)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Feature request not found",
        )
    return row


@router.post(
    "/feature-requests",
    response_model=FeatureRequestOut,
    status_code=status.HTTP_201_CREATED,
)
def create_feature_request(
    body: FeatureRequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeatureRequestOut:
    row = feature_request_service.create_request(
        db,
        user,
        title=body.title,
        description=body.description,
    )
    return FeatureRequestOut.model_validate(
        feature_request_service.to_out(row, has_voted=False)
    )


@router.get("/feature-requests", response_model=list[FeatureRequestListItem])
def list_feature_requests(
    request_status: str | None = Query(None, alias="status", pattern=STATUS_FILTER_PATTERN),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FeatureRequestListItem]:
    rows = feature_request_service.list_requests(db, status=request_status, viewer=user)
    return [
        FeatureRequestListItem.model_validate(
            feature_request_service.to_list_item(row, has_voted=voted)
        )
        for row, voted in rows
    ]


@router.get("/feature-requests/{request_id}", response_model=FeatureRequestOut)
def get_feature_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeatureRequestOut:
    row = _get_or_404(db, request_id)
    voted = feature_request_service.has_user_voted(db, request_id, user.id)
    return FeatureRequestOut.model_validate(
        feature_request_service.to_out(row, has_voted=voted)
    )


@router.patch("/feature-requests/{request_id}", response_model=FeatureRequestOut)
def update_feature_request(
    request_id: int,
    body: FeatureRequestUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeatureRequestOut:
    row = _get_or_404(db, request_id)

    if body.status is not None and not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can change status",
        )
    if not user.is_admin and row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    if not user.is_admin and body.status is None:
        # Owners may only edit content while still submitted.
        if row.status != "submitted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only submitted requests can be edited",
            )

    try:
        updated = feature_request_service.update_request(
            db,
            row,
            title=body.title,
            description=body.description,
            status=body.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    voted = feature_request_service.has_user_voted(db, request_id, user.id)
    return FeatureRequestOut.model_validate(
        feature_request_service.to_out(updated, has_voted=voted)
    )


@router.patch(
    "/admin/feature-requests/{request_id}/status",
    response_model=FeatureRequestOut,
)
def admin_update_feature_request_status(
    request_id: int,
    body: FeatureRequestStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> FeatureRequestOut:
    row = _get_or_404(db, request_id)
    try:
        updated = feature_request_service.update_request(db, row, status=body.status)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    voted = feature_request_service.has_user_voted(db, request_id, admin.id)
    return FeatureRequestOut.model_validate(
        feature_request_service.to_out(updated, has_voted=voted)
    )


@router.delete("/feature-requests/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_feature_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = _get_or_404(db, request_id)
    if not user.is_admin and row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
    feature_request_service.delete_request(db, row)


@router.post(
    "/feature-requests/{request_id}/vote",
    response_model=FeatureRequestVoteOut,
    status_code=status.HTTP_201_CREATED,
)
def vote_feature_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeatureRequestVoteOut:
    row = _get_or_404(db, request_id)
    try:
        vote = feature_request_service.add_vote(db, row, user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    db.refresh(row)
    return FeatureRequestVoteOut.model_validate(
        feature_request_service.vote_to_out(vote, vote_count=row.vote_count)
    )


@router.delete("/feature-requests/{request_id}/vote", status_code=status.HTTP_204_NO_CONTENT)
def unvote_feature_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    row = _get_or_404(db, request_id)
    try:
        feature_request_service.remove_vote(db, row, user)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get(
    "/feature-requests/{request_id}/comments",
    response_model=list[FeatureRequestCommentOut],
)
def list_feature_request_comments(
    request_id: int,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[FeatureRequestCommentOut]:
    _get_or_404(db, request_id)
    comments = feature_request_service.list_comments(db, request_id)
    return [
        FeatureRequestCommentOut.model_validate(feature_request_service.comment_to_out(c))
        for c in comments
    ]


@router.post(
    "/feature-requests/{request_id}/comments",
    response_model=FeatureRequestCommentOut,
    status_code=status.HTTP_201_CREATED,
)
def create_feature_request_comment(
    request_id: int,
    body: FeatureRequestCommentCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FeatureRequestCommentOut:
    row = _get_or_404(db, request_id)
    try:
        comment = feature_request_service.add_comment(db, row, user, comment=body.comment)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return FeatureRequestCommentOut.model_validate(
        feature_request_service.comment_to_out(comment)
    )
