from datetime import timedelta
from uuid import UUID
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from core.exceptions import AppError
from db.database import get_db
from modules.auth.security.tokens import get_current_user, opaque_token, token_hash, utc_now
from modules.users.model import Invitation, Membership, MembershipRole, Organization, User

router = APIRouter(prefix="/organizations", tags=["organizations"])
class OrganizationCreate(BaseModel): name: str = Field(min_length=1, max_length=160); slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,158}[a-z0-9]$")
class OrganizationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID; name: str; slug: str
class MembershipUpdate(BaseModel): role: MembershipRole
class InviteCreate(BaseModel): email: EmailStr; role: MembershipRole = MembershipRole.MEMBER
class AcceptInvite(BaseModel): token: str

async def membership_for(org_id: UUID, user: User, db: AsyncSession) -> Membership:
    row = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user.id))).scalar_one_or_none()
    if not row: raise AppError("Organization membership is required.", code="MEMBERSHIP_REQUIRED", status_code=403)
    return row
async def require_role(org_id: UUID, user: User, db: AsyncSession, allowed: set[MembershipRole]) -> Membership:
    member = await membership_for(org_id, user, db)
    if MembershipRole(member.role) not in allowed: raise AppError("This organization role cannot perform that action.", code="INSUFFICIENT_ROLE", status_code=403)
    return member

@router.post("", response_model=OrganizationPublic, status_code=201)
async def create_org(payload: OrganizationCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if (await db.execute(select(Organization).where(Organization.slug == payload.slug))).scalar_one_or_none(): raise AppError("Organization slug is already in use.", code="SLUG_ALREADY_EXISTS", status_code=409)
    org = Organization(name=payload.name, slug=payload.slug, created_by_id=user.id); db.add(org); await db.flush(); db.add(Membership(organization_id=org.id, user_id=user.id, role=MembershipRole.OWNER.value)); await db.commit(); await db.refresh(org); return org
@router.get("", response_model=list[OrganizationPublic])
async def list_orgs(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(Organization).join(Membership).where(Membership.user_id == user.id))).scalars().all()
@router.get("/{org_id}/members")
async def list_members(org_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await membership_for(org_id, user, db)
    rows = (await db.execute(select(Membership, User).join(User).where(Membership.organization_id == org_id))).all()
    return [{"user_id": str(m.user_id), "email": u.email, "name": u.name, "role": m.role} for m, u in rows]
@router.post("/{org_id}/invitations", status_code=201)
async def invite(org_id: UUID, payload: InviteCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    raw = opaque_token(); invite = Invitation(organization_id=org_id, email=str(payload.email).lower(), role=payload.role.value, token_hash=token_hash(raw), expires_at=utc_now() + timedelta(days=7), invited_by_id=user.id); db.add(invite); await db.commit()
    return {"id": str(invite.id), "accepted": False, "invite_token": raw} # mail adapter owns delivery in production
@router.post("/invitations/accept", status_code=204)
async def accept_invitation(payload: AcceptInvite, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    invitation = (await db.execute(select(Invitation).where(Invitation.token_hash == token_hash(payload.token)))).scalar_one_or_none()
    if not invitation or invitation.accepted_at or invitation.expires_at <= utc_now() or invitation.email != user.email: raise AppError("Invitation is invalid or expired.", code="INVALID_INVITATION", status_code=400)
    already = (await db.execute(select(Membership).where(Membership.organization_id == invitation.organization_id, Membership.user_id == user.id))).scalar_one_or_none()
    if not already: db.add(Membership(organization_id=invitation.organization_id, user_id=user.id, role=invitation.role))
    invitation.accepted_at = utc_now(); await db.commit(); return None
@router.patch("/{org_id}/members/{member_id}", status_code=204)
async def update_member_role(org_id: UUID, member_id: UUID, payload: MembershipUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    target = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.id == member_id))).scalar_one_or_none()
    if not target: raise AppError("Membership was not found.", code="MEMBERSHIP_NOT_FOUND", status_code=404)
    if target.role == MembershipRole.OWNER.value and user.id != target.user_id: raise AppError("An owner role cannot be changed by an administrator.", code="INSUFFICIENT_ROLE", status_code=403)
    target.role = payload.role.value; await db.commit(); return None
@router.delete("/{org_id}/members/{member_id}", status_code=204)
async def remove_member(org_id: UUID, member_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    target = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.id == member_id))).scalar_one_or_none()
    if not target: raise AppError("Membership was not found.", code="MEMBERSHIP_NOT_FOUND", status_code=404)
    if target.role == MembershipRole.OWNER.value: raise AppError("Transfer ownership before removing the owner.", code="OWNER_REQUIRED", status_code=409)
    await db.delete(target); await db.commit(); return None
