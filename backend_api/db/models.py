"""ORM models for authentication, plans, permissions, projects, and support."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Table,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from backend_api.db.base import Base

plan_actions = Table(
    "plan_actions",
    Base.metadata,
    Column("plan_id", ForeignKey("plans.id", ondelete="CASCADE"), primary_key=True),
    Column("action_id", ForeignKey("actions.id", ondelete="CASCADE"), primary_key=True),
)

# JSONB on PostgreSQL; plain JSON elsewhere (e.g. local SQLite tests).
JsonDict = JSON().with_variant(JSONB(), "postgresql")


class Plan(Base):
    """Subscription-style access plan: price + allowed modules + LLM models."""

    __tablename__ = "plans"
    __table_args__ = (UniqueConstraint("name", name="uq_plans_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=Decimal("0.00"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    allowed_models: Mapped[list[Any]] = mapped_column(JsonDict, default=list, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    actions: Mapped[list[Action]] = relationship(
        "Action",
        secondary=plan_actions,
        back_populates="plans",
        lazy="selectin",
    )
    users: Mapped[list[User]] = relationship(
        "User",
        back_populates="plan",
        lazy="noload",
    )

    def action_codes(self) -> list[str]:
        return sorted(action.code for action in self.actions)

    def model_ids(self) -> list[str]:
        raw = self.allowed_models or []
        return [str(item) for item in raw if str(item).strip()]


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    theme: Mapped[str] = mapped_column(String(20), default="system", nullable=False)
    plan_id: Mapped[int | None] = mapped_column(
        ForeignKey("plans.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    university: Mapped[str | None] = mapped_column(String(200), nullable=True)
    degree: Mapped[str | None] = mapped_column(String(200), nullable=True)
    major: Mapped[str | None] = mapped_column(String(200), nullable=True)
    matlab_experience: Mapped[str | None] = mapped_column(String(40), nullable=True)
    control_design_experience: Mapped[str | None] = mapped_column(String(40), nullable=True)
    profile_survey_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    feedback_survey_completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    tutorial_dont_show_again: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    plan: Mapped[Plan | None] = relationship(
        "Plan",
        back_populates="users",
        lazy="selectin",
    )
    projects: Mapped[list[Project]] = relationship(
        "Project",
        back_populates="owner",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    feedback_surveys: Mapped[list[FeedbackSurveyResponse]] = relationship(
        "FeedbackSurveyResponse",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    bug_reports: Mapped[list["BugReport"]] = relationship(
        "BugReport",
        back_populates="user",
        lazy="noload",
    )
    chat_sessions: Mapped[list["ChatSession"]] = relationship(
        "ChatSession",
        back_populates="user",
        foreign_keys="ChatSession.user_id",
        lazy="noload",
    )
    assigned_chats: Mapped[list["ChatSession"]] = relationship(
        "ChatSession",
        back_populates="agent",
        foreign_keys="ChatSession.agent_id",
        lazy="noload",
    )
    chat_reads: Mapped[list["ChatRead"]] = relationship(
        "ChatRead",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    feature_requests: Mapped[list["FeatureRequest"]] = relationship(
        "FeatureRequest",
        back_populates="user",
        lazy="noload",
    )
    tickets: Mapped[list["Ticket"]] = relationship(
        "Ticket",
        back_populates="user",
        foreign_keys="Ticket.user_id",
        lazy="noload",
    )
    assigned_tickets: Mapped[list["Ticket"]] = relationship(
        "Ticket",
        back_populates="assignee",
        foreign_keys="Ticket.assigned_to",
        lazy="noload",
    )

    def action_codes(self) -> list[str]:
        if self.plan is None:
            return []
        return self.plan.action_codes()

    def has_action(self, code: str) -> bool:
        if self.is_admin:
            return True
        return code in self.action_codes()

    def model_ids(self) -> list[str]:
        if self.plan is None:
            return []
        return self.plan.model_ids()

    def has_model(self, model: str) -> bool:
        if self.is_admin:
            return True
        return model in self.model_ids()


class Action(Base):
    __tablename__ = "actions"
    __table_args__ = (UniqueConstraint("code", name="uq_actions_code"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)

    # noload: avoid loading every Plan for every Action on each /auth/me.
    plans: Mapped[list[Plan]] = relationship(
        "Plan",
        secondary=plan_actions,
        back_populates="actions",
        lazy="noload",
    )


class AppSetting(Base):
    """Key/value application settings (e.g. default registration plan)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False, default="")


class ErrorEvent(Base):
    """Persisted application / API / frontend error for admin review."""

    __tablename__ = "error_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    stack_trace: Mapped[str | None] = mapped_column(Text, nullable=True)
    path: Mapped[str | None] = mapped_column(String(512), nullable=True, index=True)
    method: Mapped[str | None] = mapped_column(String(16), nullable=True)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    extra: Mapped[dict[str, Any] | None] = mapped_column(JsonDict, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )


class Project(Base):
    """Persisted Single Loop / Multi Loop design session for a user."""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    pipeline_type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="draft", nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    file_type: Mapped[str] = mapped_column(String(40), default="python", nullable=False)
    file_content: Mapped[str] = mapped_column(Text, default="", nullable=False)
    file_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    llm_model: Mapped[str] = mapped_column(String(100), default="gpt-4o", nullable=False)
    control_objective: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    results: Mapped[dict[str, Any] | None] = mapped_column(JsonDict, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    owner: Mapped[User] = relationship("User", back_populates="projects")


class FeedbackSurveyResponse(Base):
    """Post-use feedback survey answers — any number per user per pipeline (SILO / MULO)."""

    __tablename__ = "feedback_survey_responses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    pipeline_type: Mapped[str] = mapped_column(
        String(40),
        nullable=False,
        index=True,
    )
    satisfaction: Mapped[int] = mapped_column(Integer, nullable=False)
    ease_of_use: Mapped[int] = mapped_column(Integer, nullable=False)
    product_value: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[int] = mapped_column(Integer, nullable=False)
    reuse_intention: Mapped[int] = mapped_column(Integer, nullable=False)
    willingness_to_pay: Mapped[int] = mapped_column(Integer, nullable=False)
    main_problems: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped[User] = relationship("User", back_populates="feedback_surveys")


class TutorialVideo(Base):
    """Admin-managed how-to video clip shown in the first-login slider."""

    __tablename__ = "tutorial_videos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    file_url: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class NavMenuItem(Base):
    """Header/footer navigation link managed from the site CMS."""

    __tablename__ = "nav_menu_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    location: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    href: Mapped[str] = mapped_column(String(512), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_external: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class BlogPost(Base):
    """Markdown blog article managed from the admin CMS."""

    __tablename__ = "blog_posts"
    __table_args__ = (UniqueConstraint("slug", name="uq_blog_posts_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    slug: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    excerpt: Mapped[str] = mapped_column(Text, default="", nullable=False)
    body_markdown: Mapped[str] = mapped_column(Text, default="", nullable=False)
    cover_image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False, index=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    author_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )


class BugReport(Base):
    """User-submitted bug report with optional screenshot."""

    __tablename__ = "bug_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    page_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False, index=True)
    admin_notes: Mapped[str] = mapped_column(Text, default="", nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    fixed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User | None] = relationship("User", back_populates="bug_reports")


class ChatSession(Base):
    """Live support chat session between a user and an optional agent."""

    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    agent_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(
        "User",
        back_populates="chat_sessions",
        foreign_keys=[user_id],
    )
    agent: Mapped[User | None] = relationship(
        "User",
        back_populates="assigned_chats",
        foreign_keys=[agent_id],
    )
    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="noload",
        order_by="ChatMessage.created_at",
    )
    reads: Mapped[list["ChatRead"]] = relationship(
        "ChatRead",
        back_populates="session",
        cascade="all, delete-orphan",
        lazy="noload",
    )


class ChatMessage(Base):
    """Single message inside a live chat session."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_session_id: Mapped[int] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    session: Mapped[ChatSession] = relationship("ChatSession", back_populates="messages")
    sender: Mapped[User] = relationship("User")


class ChatRead(Base):
    """Per-user read cursor for a live chat session."""

    __tablename__ = "chat_reads"
    __table_args__ = (
        UniqueConstraint(
            "chat_session_id",
            "user_id",
            name="uq_chat_reads_session_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    chat_session_id: Mapped[int] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    last_read_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    session: Mapped[ChatSession] = relationship(
        "ChatSession",
        back_populates="reads",
    )
    user: Mapped[User] = relationship(
        "User",
        back_populates="chat_reads",
    )


class Notification(Base):
    """Persistent in-app notification for a user."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    type: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    chat_id: Mapped[int | None] = mapped_column(
        ForeignKey("chat_sessions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    user: Mapped[User] = relationship("User", back_populates="notifications")
    chat: Mapped[ChatSession | None] = relationship("ChatSession")


class FeatureRequest(Base):
    """User-submitted product feature idea with voting and comments."""

    __tablename__ = "feature_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(40),
        default="submitted",
        nullable=False,
        index=True,
    )
    vote_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    user: Mapped[User] = relationship("User", back_populates="feature_requests")
    votes: Mapped[list["FeatureRequestVote"]] = relationship(
        "FeatureRequestVote",
        back_populates="feature_request",
        cascade="all, delete-orphan",
        lazy="noload",
    )
    comments: Mapped[list["FeatureRequestComment"]] = relationship(
        "FeatureRequestComment",
        back_populates="feature_request",
        cascade="all, delete-orphan",
        lazy="noload",
        order_by="FeatureRequestComment.created_at",
    )


class FeatureRequestVote(Base):
    """One vote per user per feature request."""

    __tablename__ = "feature_request_votes"
    __table_args__ = (
        UniqueConstraint(
            "feature_request_id",
            "user_id",
            name="uq_feature_request_votes_request_user",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feature_request_id: Mapped[int] = mapped_column(
        ForeignKey("feature_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    feature_request: Mapped[FeatureRequest] = relationship(
        "FeatureRequest",
        back_populates="votes",
    )
    user: Mapped[User] = relationship("User")


class FeatureRequestComment(Base):
    """Comment on a feature request."""

    __tablename__ = "feature_request_comments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    feature_request_id: Mapped[int] = mapped_column(
        ForeignKey("feature_requests.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    comment: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    feature_request: Mapped[FeatureRequest] = relationship(
        "FeatureRequest",
        back_populates="comments",
    )
    user: Mapped[User] = relationship("User")


class Ticket(Base):
    """Support ticket submitted by a user and optionally assigned to an admin."""

    __tablename__ = "tickets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_to: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(40), default="general", nullable=False, index=True)
    priority: Mapped[str] = mapped_column(String(40), default="medium", nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(40), default="open", nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(
        "User",
        back_populates="tickets",
        foreign_keys=[user_id],
    )
    assignee: Mapped[User | None] = relationship(
        "User",
        back_populates="assigned_tickets",
        foreign_keys=[assigned_to],
    )
    messages: Mapped[list["TicketMessage"]] = relationship(
        "TicketMessage",
        back_populates="ticket",
        cascade="all, delete-orphan",
        lazy="noload",
        order_by="TicketMessage.created_at",
    )


class TicketMessage(Base):
    """Reply/message on a support ticket."""

    __tablename__ = "ticket_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ticket_id: Mapped[int] = mapped_column(
        ForeignKey("tickets.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    sender_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )

    ticket: Mapped[Ticket] = relationship("Ticket", back_populates="messages")
    sender: Mapped[User] = relationship("User")
