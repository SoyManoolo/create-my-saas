from datetime import datetime
from enum import StrEnum
from uuid import UUID
from uuid6 import uuid7
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from src.db.base import Base, utc_now

class MembershipRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    BILLING = "billing"

class TokenPurpose(StrEnum):
    EMAIL_VERIFICATION = "email_verification"
    PASSWORD_RESET = "password_reset"

class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    memberships: Mapped[list["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan")

class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    jti: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class OAuthState(Base):
    __tablename__ = "oauth_states"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    state_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # Kept server-side only for the short authorization-code exchange window.
    code_verifier: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

class OAuthAccount(Base):
    """An immutable external subject explicitly linked to a local user."""
    __tablename__ = "oauth_accounts"
    __table_args__ = (UniqueConstraint("provider", "provider_account_id", name="uq_oauth_account_provider_subject"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    provider: Mapped[str] = mapped_column(String(80), nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class OneTimeToken(Base):
    __tablename__ = "one_time_tokens"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class Organization(Base):
    __tablename__ = "organizations"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), unique=True, index=True, nullable=False)
    created_by_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    memberships: Mapped[list["Membership"]] = relationship(back_populates="organization", cascade="all, delete-orphan")

class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (UniqueConstraint("organization_id", "user_id", name="uq_membership_org_user"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default=MembershipRole.MEMBER.value, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    organization: Mapped[Organization] = relationship(back_populates="memberships")
    user: Mapped[User] = relationship(back_populates="memberships")

class Invitation(Base):
    __tablename__ = "invitations"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    role: Mapped[str] = mapped_column(String(20), default=MembershipRole.MEMBER.value, nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    invited_by_id: Mapped[UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class AuditLog(Base):
    """Append-only security history with deliberately constrained metadata."""
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_org_created_id", "organization_id", "created_at", "id"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    actor_user_id: Mapped[UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), nullable=False)
    target_id: Mapped[str | None] = mapped_column(String(255))
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class Subscription(Base):
    __tablename__ = "subscriptions"
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, index=True)
    provider: Mapped[str] = mapped_column(String(40), default="manual", nullable=False)
    provider_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    provider_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    plan: Mapped[str] = mapped_column(String(60), default="free", nullable=False)
    status: Mapped[str] = mapped_column(String(40), default="active", nullable=False)
    seats: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    metadata_: Mapped[dict] = mapped_column("metadata", JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

class BillingEntitlement(Base):
    __tablename__ = "billing_entitlements"
    __table_args__ = (UniqueConstraint("organization_id", "key", name="uq_billing_entitlement_org_key"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    limit_value: Mapped[int | None] = mapped_column(Integer)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source: Mapped[str] = mapped_column(String(60), default="free", nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

class UsageRecord(Base):
    __tablename__ = "usage_records"
    __table_args__ = (UniqueConstraint("organization_id", "idempotency_key", name="uq_usage_record_org_idempotency"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    metric: Mapped[str] = mapped_column(String(100), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    reported_to_provider: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

class BillingWebhookEvent(Base):
    __tablename__ = "billing_webhook_events"
    __table_args__ = (UniqueConstraint("provider", "provider_event_id", name="uq_billing_webhook_provider_event"),)
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    provider_event_id: Mapped[str] = mapped_column(String(255), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
