from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import AppError
from src.modules.users.model import Membership, MembershipRole, Organization, User


async def membership_for(org_id: UUID, user: User, db: AsyncSession) -> Membership:
    membership = (
        await db.execute(
            select(Membership).where(
                Membership.organization_id == org_id,
                Membership.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not membership:
        raise AppError(
            "Organization membership is required.",
            code="MEMBERSHIP_REQUIRED",
            status_code=403,
        )
    return membership


async def require_role(
    org_id: UUID,
    user: User,
    db: AsyncSession,
    allowed: set[MembershipRole],
) -> Membership:
    membership = await membership_for(org_id, user, db)
    if MembershipRole(membership.role) not in allowed:
        raise AppError(
            "This organization role cannot perform that action.",
            code="INSUFFICIENT_ROLE",
            status_code=403,
        )
    return membership


async def lock_organization(org_id: UUID, db: AsyncSession) -> Organization:
    organization = (
        await db.execute(
            select(Organization)
            .where(Organization.id == org_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if not organization:
        raise AppError(
            "Organization membership is required.",
            code="MEMBERSHIP_REQUIRED",
            status_code=403,
        )
    return organization
