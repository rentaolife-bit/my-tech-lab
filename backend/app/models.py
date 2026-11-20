import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy import (
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class IdMixin:
    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class OwnedMixin:
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )


class VersionedMixin:
    version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("1")
    )


class SoftDeleteMixin:
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class BusinessMixin(IdMixin, TimestampMixin, OwnedMixin, VersionedMixin):
    """Common columns for business tables that carry a legacy id and are never deleted."""


class SoftDeleteBusinessMixin(BusinessMixin, SoftDeleteMixin):
    """Common columns for business tables that support soft delete."""


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index(
            "uq_users_single_owner",
            "is_owner",
            unique=True,
            postgresql_where=sa_text("is_owner IS TRUE"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    username: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_owner: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    identities: Mapped[list["AuthIdentity"]] = relationship(back_populates="user")


class AuthIdentity(Base):
    __tablename__ = "auth_identities"
    __table_args__ = (
        UniqueConstraint("provider", "provider_sub", name="uq_auth_identities_provider_sub"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    provider_sub: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped["User"] = relationship(back_populates="identities")


class Task(SoftDeleteBusinessMixin, Base):
    __tablename__ = "tasks"
    __table_args__ = (
        UniqueConstraint("user_id", "legacy_id", name="uq_tasks_user_legacy"),
    )

    legacy_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sa_text("'medium'")
    )
    completed: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=sa_text("false")
    )
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class Note(SoftDeleteBusinessMixin, Base):
    __tablename__ = "notes"
    __table_args__ = (
        UniqueConstraint("user_id", "legacy_id", name="uq_notes_user_legacy"),
    )

    legacy_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)


class Idea(SoftDeleteBusinessMixin, Base):
    __tablename__ = "ideas"
    __table_args__ = (
        UniqueConstraint("user_id", "legacy_id", name="uq_ideas_user_legacy"),
    )

    legacy_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)


class DocumentSummary(SoftDeleteBusinessMixin, Base):
    __tablename__ = "document_summaries"
    __table_args__ = (
        UniqueConstraint("user_id", "legacy_id", name="uq_document_summaries_user_legacy"),
    )

    legacy_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[dict] = mapped_column(JSONB, nullable=False)
    analysis_mode: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(Text, nullable=True)


class DailyFocusEntry(BusinessMixin, Base):
    __tablename__ = "daily_focus_entries"
    __table_args__ = (
        UniqueConstraint("user_id", "focus_date", name="uq_daily_focus_user_date"),
    )

    focus_date: Mapped[date] = mapped_column(Date, nullable=False)
    priorities: Mapped[dict] = mapped_column(JSONB, nullable=False)


class AIConversation(SoftDeleteBusinessMixin, Base):
    __tablename__ = "ai_conversations"

    title: Mapped[str | None] = mapped_column(Text, nullable=True)

    messages: Mapped[list["AIMessage"]] = relationship(
        back_populates="conversation", cascade="all, delete-orphan"
    )


class AIMessage(Base):
    __tablename__ = "ai_messages"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("ai_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    conversation: Mapped["AIConversation"] = relationship(back_populates="messages")


class UserPreferences(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    enabled_by_id: Mapped[dict] = mapped_column(JSONB, nullable=False)
    schema_version: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("1")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class MigrationBatch(Base):
    __tablename__ = "migration_batches"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_device: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    status: Mapped[str] = mapped_column(
        Text, nullable=False, server_default=sa_text("'pending'")
    )
    source_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    imported_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    skipped_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    conflict_count: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    report: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class OTPCode(Base):
    __tablename__ = "otp_codes"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash: Mapped[str] = mapped_column(Text, nullable=False)
    salt: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default=sa_text("0")
    )
    consumed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid, primary_key=True, server_default=sa_text("gen_random_uuid()")
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
