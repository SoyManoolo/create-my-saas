from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.exceptions import AppError
from src.modules.organizations.schemas import OrganizationCreate
from src.modules.users.model import Membership, MembershipRole, Organization, User


async def create_organization(
    payload: OrganizationCreate,
    user: User,
    db: AsyncSession,
) -> Organization:
    existing = (
        await db.execute(select(Organization).where(Organization.slug == payload.slug))
    ).scalar_one_or_none()
    if existing:
        raise AppError(
            "Organization slug is already in use.",
            code="SLUG_ALREADY_EXISTS",
            status_code=409,
        )
    organization = Organization(
        name=payload.name,
        slug=payload.slug,
        created_by_id=user.id,
    )
    db.add(organization)
    await db.flush()
    db.add(
        Membership(
            organization_id=organization.id,
            user_id=user.id,
            role=MembershipRole.OWNER.value,
        )
    )
    await db.commit()
    await db.refresh(organization)
    return organization


async def list_organizations(user: User, db: AsyncSession):
    return (
        await db.execute(
            select(Organization)
            .join(Membership)
            .where(Membership.user_id == user.id)
        )
    ).scalars().all()
