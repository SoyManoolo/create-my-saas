from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import AppError
from src.modules.audit.service import AuditAction, record_audit_event
from src.modules.organizations.access import (
    lock_organization,
    membership_for,
    require_role,
)
from src.modules.organizations.schemas import MembershipUpdate
from src.modules.users.model import Membership, MembershipRole, User


async def list_members(org_id: UUID, user: User, db: AsyncSession):
    await membership_for(org_id, user, db)
    rows = (
        await db.execute(
            select(Membership, User)
            .join(User)
            .where(Membership.organization_id == org_id)
        )
    ).all()
    return [
        {
            "user_id": str(membership.user_id),
            "email": member.email,
            "name": member.name,
            "role": membership.role,
        }
        for membership, member in rows
    ]


async def update_member_role(
    org_id: UUID,
    member_id: UUID,
    payload: MembershipUpdate,
    user: User,
    db: AsyncSession,
) -> None:
    await lock_organization(org_id, db)
    await require_role(
        org_id,
        user,
        db,
        {MembershipRole.OWNER, MembershipRole.ADMIN},
    )
    target = (
        await db.execute(
            select(Membership)
            .where(
                Membership.organization_id == org_id,
                Membership.id == member_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not target:
        raise AppError(
            "Membership was not found.",
            code="MEMBERSHIP_NOT_FOUND",
            status_code=404,
        )
    if target.role == MembershipRole.OWNER.value or payload.role == MembershipRole.OWNER:
        raise AppError(
            "Owner role cannot be changed through this endpoint.",
            code="OWNER_ROLE_PROTECTED",
            status_code=400,
        )
    previous_role = target.role
    if previous_role != payload.role.value:
        target.role = payload.role.value
        record_audit_event(
            db,
            organization_id=org_id,
            actor_user_id=user.id,
            action=AuditAction.MEMBER_ROLE_CHANGED,
            target_type="user",
            target_id=target.user_id,
            metadata={
                "previousRole": previous_role,
                "newRole": payload.role.value,
            },
        )
    await db.commit()


async def remove_member(
    org_id: UUID,
    member_id: UUID,
    user: User,
    db: AsyncSession,
) -> None:
    await lock_organization(org_id, db)
    await require_role(
        org_id,
        user,
        db,
        {MembershipRole.OWNER, MembershipRole.ADMIN},
    )
    target = (
        await db.execute(
            select(Membership)
            .where(
                Membership.organization_id == org_id,
                Membership.id == member_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not target:
        raise AppError(
            "Membership was not found.",
            code="MEMBERSHIP_NOT_FOUND",
            status_code=404,
        )
    if target.role == MembershipRole.OWNER.value:
        raise AppError(
            "Transfer ownership before removing the owner.",
            code="OWNER_REQUIRED",
            status_code=409,
        )
    record_audit_event(
        db,
        organization_id=org_id,
        actor_user_id=user.id,
        action=AuditAction.MEMBER_REMOVED,
        target_type="user",
        target_id=target.user_id,
        metadata={"role": target.role},
    )
    await db.delete(target)
    await db.commit()
