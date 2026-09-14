from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import AppError
from src.modules.audit.service import AuditAction, record_audit_event
from src.modules.organizations.access import lock_organization
from src.modules.organizations.schemas import OwnershipTransfer
from src.modules.users.model import Membership, MembershipRole, User


async def transfer_ownership(
    org_id: UUID,
    payload: OwnershipTransfer,
    user: User,
    db: AsyncSession,
) -> None:
    if payload.user_id == user.id:
        raise AppError(
            "Ownership must be transferred to another active organization member.",
            code="OWNERSHIP_TARGET_NOT_ELIGIBLE",
            status_code=409,
        )

    try:
        # Match deactivation's user-then-organization lock order. Sorting user
        # locks also prevents reciprocal transfers from deadlocking.
        user_ids = sorted({user.id, payload.user_id}, key=str)
        locked_users = (
            await db.execute(
                select(User)
                .where(User.id.in_(user_ids))
                .order_by(User.id)
                .with_for_update()
            )
        ).scalars().all()
        users_by_id = {locked_user.id: locked_user for locked_user in locked_users}
        actor = users_by_id.get(user.id)
        target_user = users_by_id.get(payload.user_id)

        await lock_organization(org_id, db)
        memberships = (
            await db.execute(
                select(Membership)
                .where(
                    Membership.organization_id == org_id,
                    Membership.user_id.in_(user_ids),
                )
                .order_by(Membership.user_id)
                .with_for_update()
            )
        ).scalars().all()
        memberships_by_user = {
            membership.user_id: membership for membership in memberships
        }
        current_owner = memberships_by_user.get(user.id)
        target = memberships_by_user.get(payload.user_id)

        if (
            not actor
            or not actor.is_active
            or not current_owner
            or current_owner.role != MembershipRole.OWNER.value
        ):
            raise AppError(
                "Only the current organization owner can transfer ownership.",
                code="INSUFFICIENT_ROLE",
                status_code=403,
            )
        if not target_user or not target_user.is_active or not target:
            raise AppError(
                "Ownership can only be transferred to an active organization member.",
                code="OWNERSHIP_TARGET_NOT_ELIGIBLE",
                status_code=409,
            )

        # Both role changes remain invisible until the same transaction commits.
        target_previous_role = target.role
        target.role = MembershipRole.OWNER.value
        current_owner.role = MembershipRole.ADMIN.value
        record_audit_event(
            db,
            organization_id=org_id,
            actor_user_id=user.id,
            action=AuditAction.OWNERSHIP_TRANSFERRED,
            target_type="user",
            target_id=payload.user_id,
            metadata={
                "previousOwnerNewRole": MembershipRole.ADMIN.value,
                "newOwnerPreviousRole": target_previous_role,
            },
        )
        await db.commit()
    except Exception:
        await db.rollback()
        raise
