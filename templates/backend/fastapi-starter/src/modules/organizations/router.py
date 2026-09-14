from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.database import get_db
from src.modules.auth.security.tokens import get_current_user
from src.modules.organizations import (
    invitations,
    member_service,
    ownership_service,
    service,
)
from src.modules.organizations.schemas import (
    AcceptInvite,
    InviteCreate,
    MembershipUpdate,
    OrganizationCreate,
    OrganizationPublic,
    OwnershipTransfer,
)
from src.modules.users.model import User


router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.post("", response_model=OrganizationPublic, status_code=201)
async def create_org(
    payload: OrganizationCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.create_organization(payload, user, db)


@router.get("", response_model=list[OrganizationPublic])
async def list_orgs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await service.list_organizations(user, db)


@router.get("/{org_id}/members")
async def list_members(
    org_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await member_service.list_members(org_id, user, db)


@router.post("/{org_id}/invitations", status_code=201)
async def invite(
    org_id: UUID,
    payload: InviteCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await invitations.invite(org_id, payload, user, db)


@router.post("/invitations/accept", status_code=204)
async def accept_invitation(
    payload: AcceptInvite,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await invitations.accept_invitation(payload, user, db)


@router.patch("/{org_id}/members/{member_id}", status_code=204)
async def update_member_role(
    org_id: UUID,
    member_id: UUID,
    payload: MembershipUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await member_service.update_member_role(
        org_id,
        member_id,
        payload,
        user,
        db,
    )


@router.delete("/{org_id}/members/{member_id}", status_code=204)
async def remove_member(
    org_id: UUID,
    member_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await member_service.remove_member(org_id, member_id, user, db)


@router.post("/{org_id}/ownership/transfer", status_code=204)
async def transfer_ownership(
    org_id: UUID,
    payload: OwnershipTransfer,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await ownership_service.transfer_ownership(org_id, payload, user, db)
