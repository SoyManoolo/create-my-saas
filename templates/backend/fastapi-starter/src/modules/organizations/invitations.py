from datetime import timedelta
from uuid import UUID

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.email import send_secure_email
from src.core.exceptions import AppError
from src.modules.audit.service import AuditAction, record_audit_event
from src.modules.auth.security.tokens import opaque_token, token_hash, utc_now
from src.modules.organizations.access import require_role
from src.modules.organizations.schemas import AcceptInvite, InviteCreate
from src.modules.users.model import Invitation, Membership, MembershipRole, User


async def invite(
    org_id: UUID,
    payload: InviteCreate,
    user: User,
    db: AsyncSession,
):
    await require_role(
        org_id,
        user,
        db,
        {MembershipRole.OWNER, MembershipRole.ADMIN},
    )
    if payload.role == MembershipRole.OWNER:
        raise AppError(
            "Owner invitations are not permitted.",
            code="OWNER_ROLE_PROTECTED",
            status_code=400,
        )

    email = str(payload.email).lower()
    now = utc_now()
    raw_token = opaque_token()
    values = {
        "organization_id": org_id,
        "email": email,
        "role": payload.role.value,
        "token_hash": token_hash(raw_token),
        "expires_at": now + timedelta(days=7),
        "invited_by_id": user.id,
    }
    invitation_id = (
        await db.execute(
            postgres_insert(Invitation)
            .values(**values)
            .on_conflict_do_nothing(
                index_elements=[Invitation.organization_id, Invitation.email],
                index_where=(
                    Invitation.accepted_at.is_(None)
                    & Invitation.cancelled_at.is_(None)
                ),
            )
            .returning(Invitation.id)
        )
    ).scalar_one_or_none()
    deliver = invitation_id is not None

    if invitation_id is None:
        # The partial unique index makes this lock cover one pending invite.
        invitation = (
            await db.execute(
                select(Invitation)
                .where(
                    Invitation.organization_id == org_id,
                    Invitation.email == email,
                    Invitation.accepted_at.is_(None),
                    Invitation.cancelled_at.is_(None),
                )
                .with_for_update()
            )
        ).scalar_one()
        invitation_id = invitation.id
        if invitation.expires_at <= now:
            invitation.role = payload.role.value
            invitation.token_hash = values["token_hash"]
            invitation.expires_at = values["expires_at"]
            invitation.invited_by_id = user.id
            deliver = True

    if deliver:
        record_audit_event(
            db,
            organization_id=org_id,
            actor_user_id=user.id,
            action=AuditAction.INVITATION_CREATED,
            target_type="invitation",
            target_id=invitation_id,
            metadata={"email": email, "role": payload.role.value},
        )

    try:
        await db.commit()
    except Exception:
        await db.rollback()
        raise

    if deliver:
        await send_secure_email(
            recipient=email,
            subject="Organization invitation",
            body=f"Use this one-time invitation token: {raw_token}",
        )
    return {"id": str(invitation_id), "accepted": False}


async def accept_invitation(
    payload: AcceptInvite,
    user: User,
    db: AsyncSession,
) -> None:
    now = utc_now()
    invitation_hash = token_hash(payload.token)
    accepted = (
        await db.execute(
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
            .returning(
                Invitation.id,
                Invitation.organization_id,
                Invitation.role,
            )
        )
    ).one_or_none()
    if accepted:
        await db.execute(
            postgres_insert(Membership)
            .values(
                organization_id=accepted.organization_id,
                user_id=user.id,
                role=accepted.role,
            )
            .on_conflict_do_nothing(
                index_elements=[Membership.organization_id, Membership.user_id]
            )
        )
        record_audit_event(
            db,
            organization_id=accepted.organization_id,
            actor_user_id=user.id,
            action=AuditAction.INVITATION_ACCEPTED,
            target_type="invitation",
            target_id=accepted.id,
            metadata={"role": accepted.role},
        )
        try:
            await db.commit()
        except Exception:
            await db.rollback()
            raise
        return None

    # Completed retries are a no-op for the same recipient, while an expired,
    # cancelled, or foreign invitation remains invalid.
    invitation = (
        await db.execute(
            select(Invitation).where(Invitation.token_hash == invitation_hash)
        )
    ).scalar_one_or_none()
    if invitation and invitation.accepted_at and invitation.email == user.email:
        return None
    raise AppError(
        "Invitation is invalid or expired.",
        code="INVALID_INVITATION",
        status_code=400,
    )
