from datetime import timedelta
from uuid import UUID
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.exceptions import AppError
from src.core.email import send_secure_email
from src.db.database import get_db
from src.modules.auth.security.tokens import get_current_user, opaque_token, token_hash, utc_now
from src.modules.users.model import Invitation, Membership, MembershipRole, Organization, User

router = APIRouter(prefix="/organizations", tags=["organizations"])
class OrganizationCreate(BaseModel): name: str = Field(min_length=1, max_length=160); slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,158}[a-z0-9]$")
class OrganizationPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID; name: str; slug: str
class MembershipUpdate(BaseModel): role: MembershipRole
class InviteCreate(BaseModel): email: EmailStr; role: MembershipRole = MembershipRole.MEMBER
class AcceptInvite(BaseModel): token: str
class OwnershipTransfer(BaseModel): user_id: UUID

async def membership_for(org_id: UUID, user: User, db: AsyncSession) -> Membership:
    row = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.user_id == user.id))).scalar_one_or_none()
    if not row: raise AppError("Organization membership is required.", code="MEMBERSHIP_REQUIRED", status_code=403)
    return row
async def require_role(org_id: UUID, user: User, db: AsyncSession, allowed: set[MembershipRole]) -> Membership:
    member = await membership_for(org_id, user, db)
    if MembershipRole(member.role) not in allowed: raise AppError("This organization role cannot perform that action.", code="INSUFFICIENT_ROLE", status_code=403)
    return member

async def lock_organization(org_id: UUID, db: AsyncSession) -> Organization:
    organization = (await db.execute(select(Organization).where(Organization.id == org_id).with_for_update())).scalar_one_or_none()
    if not organization: raise AppError("Organization membership is required.", code="MEMBERSHIP_REQUIRED", status_code=403)
    return organization

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
    if payload.role == MembershipRole.OWNER:
        raise AppError("Owner invitations are not permitted.", code="OWNER_ROLE_PROTECTED", status_code=400)
    email = str(payload.email).lower()
    now = utc_now()
    raw = opaque_token()
    values = {
        "organization_id": org_id,
        "email": email,
        "role": payload.role.value,
        "token_hash": token_hash(raw),
        "expires_at": now + timedelta(days=7),
        "invited_by_id": user.id,
    }
    created_id = (await db.execute(
        postgres_insert(Invitation)
        .values(**values)
        .on_conflict_do_nothing(
            index_elements=[Invitation.organization_id, Invitation.email],
            index_where=(Invitation.accepted_at.is_(None) & Invitation.cancelled_at.is_(None)),
        )
        .returning(Invitation.id)
    )).scalar_one_or_none()
    deliver = created_id is not None
    invitation_id = created_id

    if invitation_id is None:
        # The partial unique index makes this lock cover a single pending invite.
        # A concurrent caller either waits here or observes the already-created row.
        invitation = (await db.execute(
            select(Invitation)
            .where(
                Invitation.organization_id == org_id,
                Invitation.email == email,
                Invitation.accepted_at.is_(None),
                Invitation.cancelled_at.is_(None),
            )
            .with_for_update()
        )).scalar_one()
        invitation_id = invitation.id
        if invitation.expires_at <= now:
            invitation.role = payload.role.value
            invitation.token_hash = values["token_hash"]
            invitation.expires_at = values["expires_at"]
            invitation.invited_by_id = user.id
            deliver = True

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    if deliver:
        await send_secure_email(recipient=email, subject="Organization invitation", body=f"Use this one-time invitation token: {raw}")
    return {"id": str(invitation_id), "accepted": False}
@router.post("/invitations/accept", status_code=204)
async def accept_invitation(payload: AcceptInvite, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    now = utc_now()
    invitation_hash = token_hash(payload.token)
    accepted = (await db.execute(
        update(Invitation)
        .where(
            Invitation.token_hash == invitation_hash,
            Invitation.accepted_at.is_(None),
            Invitation.cancelled_at.is_(None),
            Invitation.expires_at > now,
            Invitation.email == user.email,
            Invitation.role != MembershipRole.OWNER.value,
        )
        .values(accepted_at=now)
        .returning(Invitation.organization_id, Invitation.role)
    )).one_or_none()
    if accepted:
        await db.execute(
            postgres_insert(Membership)
            .values(organization_id=accepted.organization_id, user_id=user.id, role=accepted.role)
            .on_conflict_do_nothing(index_elements=[Membership.organization_id, Membership.user_id])
        )
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return None

    # A completed request is deliberately a no-op for the same recipient. This
    # makes retries and concurrent accepts idempotent without accepting a token
    # for another account or reviving an expired/cancelled invitation.
    invitation = (await db.execute(select(Invitation).where(Invitation.token_hash == invitation_hash))).scalar_one_or_none()
    if invitation and invitation.accepted_at and invitation.email == user.email:
        return None
    raise AppError("Invitation is invalid or expired.", code="INVALID_INVITATION", status_code=400)
@router.patch("/{org_id}/members/{member_id}", status_code=204)
async def update_member_role(org_id: UUID, member_id: UUID, payload: MembershipUpdate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await lock_organization(org_id, db)
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    target = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.id == member_id).with_for_update())).scalar_one_or_none()
    if not target: raise AppError("Membership was not found.", code="MEMBERSHIP_NOT_FOUND", status_code=404)
    if target.role == MembershipRole.OWNER.value or payload.role == MembershipRole.OWNER:
        raise AppError("Owner role cannot be changed through this endpoint.", code="OWNER_ROLE_PROTECTED", status_code=400)
    target.role = payload.role.value; await db.commit(); return None
@router.delete("/{org_id}/members/{member_id}", status_code=204)
async def remove_member(org_id: UUID, member_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await lock_organization(org_id, db)
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN})
    target = (await db.execute(select(Membership).where(Membership.organization_id == org_id, Membership.id == member_id).with_for_update())).scalar_one_or_none()
    if not target: raise AppError("Membership was not found.", code="MEMBERSHIP_NOT_FOUND", status_code=404)
    if target.role == MembershipRole.OWNER.value: raise AppError("Transfer ownership before removing the owner.", code="OWNER_REQUIRED", status_code=409)
    await db.delete(target); await db.commit(); return None

@router.post("/{org_id}/ownership/transfer", status_code=204)
async def transfer_ownership(org_id: UUID, payload: OwnershipTransfer, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if payload.user_id == user.id:
        raise AppError("Ownership must be transferred to another active organization member.", code="OWNERSHIP_TARGET_NOT_ELIGIBLE", status_code=409)

    try:
        # User locks make transfer safe against either account being deactivated.
        # The deterministic order prevents reciprocal transfers from deadlocking.
        user_ids = sorted({user.id, payload.user_id}, key=str)
        locked_users = (await db.execute(
            select(User).where(User.id.in_(user_ids)).order_by(User.id).with_for_update()
        )).scalars().all()
        users_by_id = {locked_user.id: locked_user for locked_user in locked_users}
        actor = users_by_id.get(user.id)
        target_user = users_by_id.get(payload.user_id)

        await lock_organization(org_id, db)
        memberships = (await db.execute(
            select(Membership)
            .where(Membership.organization_id == org_id, Membership.user_id.in_(user_ids))
            .order_by(Membership.user_id)
            .with_for_update()
        )).scalars().all()
        memberships_by_user = {membership.user_id: membership for membership in memberships}
        current_owner = memberships_by_user.get(user.id)
        target = memberships_by_user.get(payload.user_id)

        if not actor or not actor.is_active or not current_owner or current_owner.role != MembershipRole.OWNER.value:
            raise AppError("Only the current organization owner can transfer ownership.", code="INSUFFICIENT_ROLE", status_code=403)
        if not target_user or not target_user.is_active or not target:
            raise AppError("Ownership can only be transferred to an active organization member.", code="OWNERSHIP_TARGET_NOT_ELIGIBLE", status_code=409)

        # Promote before demoting. Both writes remain invisible until this single
        # transaction commits, so observers never see an ownerless organization.
        target.role = MembershipRole.OWNER.value
        current_owner.role = MembershipRole.ADMIN.value
        await db.commit()
        return None
    except Exception:
        await db.rollback()
        raise
