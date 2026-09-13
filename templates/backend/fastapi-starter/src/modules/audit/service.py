from __future__ import annotations

from enum import StrEnum
from typing import Mapping
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.users.model import AuditLog

AuditValue = str | int | bool | None


class AuditAction(StrEnum):
    INVITATION_CREATED = "organization.invitation.created"
    INVITATION_ACCEPTED = "organization.invitation.accepted"
    MEMBER_ROLE_CHANGED = "organization.member.role_changed"
    MEMBER_REMOVED = "organization.member.removed"
    OWNERSHIP_TRANSFERRED = "organization.ownership.transferred"
    BILLING_CHECKOUT_CREATED = "billing.checkout.created"
    BILLING_PORTAL_CREATED = "billing.portal.created"


# Audit metadata is intentionally allowlisted. Never add credentials, opaque
# tokens, request bodies, provider object IDs, payment methods or card details.
_ALLOWED_METADATA: dict[AuditAction, frozenset[str]] = {
    AuditAction.INVITATION_CREATED: frozenset({"email", "role"}),
    AuditAction.INVITATION_ACCEPTED: frozenset({"role"}),
    AuditAction.MEMBER_ROLE_CHANGED: frozenset({"previousRole", "newRole"}),
    AuditAction.MEMBER_REMOVED: frozenset({"role"}),
    AuditAction.OWNERSHIP_TRANSFERRED: frozenset({"previousOwnerNewRole", "newOwnerPreviousRole"}),
    AuditAction.BILLING_CHECKOUT_CREATED: frozenset({"provider", "plan", "quantity"}),
    AuditAction.BILLING_PORTAL_CREATED: frozenset({"provider"}),
}


def record_audit_event(
    db: AsyncSession,
    *,
    organization_id: UUID,
    actor_user_id: UUID | None,
    action: AuditAction,
    target_type: str,
    target_id: UUID | str | None = None,
    metadata: Mapping[str, AuditValue] | None = None,
) -> AuditLog:
    safe_metadata = dict(metadata or {})
    unexpected = safe_metadata.keys() - _ALLOWED_METADATA[action]
    if unexpected:
        raise ValueError(f"Audit metadata is not allowed for {action}: {', '.join(sorted(unexpected))}")
    if any(isinstance(value, (dict, list, tuple, set)) for value in safe_metadata.values()):
        raise ValueError("Audit metadata values must be scalar.")
    event = AuditLog(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        action=action.value,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        metadata_=safe_metadata,
    )
    db.add(event)
    return event
