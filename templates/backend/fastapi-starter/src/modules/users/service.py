from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.email import EmailDeliveryError
from src.core.exceptions import AppError
from src.modules.auth.security.password import hash_password, verify_password
from src.modules.auth.security.tokens import utc_now
from src.modules.auth.service import AuthService
from src.modules.users.model import (
    Membership,
    MembershipRole,
    Organization,
    RefreshToken,
    TokenPurpose,
    User,
)
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import (
    ChangePassword,
    ResetPasswordConfirm,
    ResetPasswordRequest,
    TokenRequest,
    UserUpdate,
)


async def update_profile(
    payload: UserUpdate,
    current_user: User,
    users: UserRepository,
) -> User:
    if payload.name is not None:
        current_user.name = payload.name
    return await users.save(current_user)


async def change_password(
    payload: ChangePassword,
    current_user: User,
    db: AsyncSession,
    users: UserRepository,
) -> None:
    if not current_user.password_hash or not verify_password(
        payload.current_password,
        current_user.password_hash,
    ):
        raise AppError(
            "Current password is incorrect.",
            code="INVALID_CREDENTIALS",
            status_code=401,
        )
    current_user.password_hash = hash_password(payload.new_password)
    await users.save(current_user)
    await AuthService(db, users).revoke_all(current_user.id)


async def deactivate(current_user: User, db: AsyncSession) -> None:
    # Ownership transfers use the same user-then-organization lock order, so a
    # user cannot become the sole owner while deactivation is in flight.
    locked_user = (
        await db.execute(
            select(User).where(User.id == current_user.id).with_for_update()
        )
    ).scalar_one_or_none()
    if not locked_user or not locked_user.is_active:
        raise AppError(
            "The user account is inactive.",
            code="USER_INACTIVE",
            status_code=403,
        )
    owned_orgs = (
        await db.execute(
            select(Membership.organization_id).where(
                Membership.user_id == current_user.id,
                Membership.role == MembershipRole.OWNER.value,
            )
        )
    ).scalars().all()
    if owned_orgs:
        await db.execute(
            select(Organization.id)
            .where(Organization.id.in_(sorted(owned_orgs, key=str)))
            .order_by(Organization.id)
            .with_for_update()
        )
    for organization_id in owned_orgs:
        active_owners = (
            await db.execute(
                select(Membership.id)
                .join(User, Membership.user_id == User.id)
                .where(
                    Membership.organization_id == organization_id,
                    Membership.role == MembershipRole.OWNER.value,
                    User.is_active.is_(True),
                )
            )
        ).scalars().all()
        if len(active_owners) <= 1:
            raise AppError(
                "Transfer ownership to another active user before deactivating this account.",
                code="LAST_ACTIVE_OWNER",
                status_code=409,
            )
    locked_user.is_active = False
    await db.execute(
        update(RefreshToken)
        .where(
            RefreshToken.user_id == current_user.id,
            RefreshToken.revoked_at.is_(None),
        )
        .values(revoked_at=utc_now())
    )
    await db.commit()


async def request_password_reset(
    payload: ResetPasswordRequest,
    db: AsyncSession,
    users: UserRepository,
) -> dict[str, bool]:
    user = await users.get_user_by_email(str(payload.email))
    if user and user.is_active:
        try:
            await AuthService(db, users).send_one_time_token(
                user,
                TokenPurpose.PASSWORD_RESET,
            )
        except EmailDeliveryError:
            # Delivery failures must not become an account-enumeration oracle.
            pass
    return {"accepted": True}


async def confirm_password_reset(
    payload: ResetPasswordConfirm,
    db: AsyncSession,
    users: UserRepository,
) -> None:
    auth = AuthService(db, users)
    user = await auth.consume_one_time_token(
        payload.token,
        TokenPurpose.PASSWORD_RESET,
    )
    if not user:
        raise AppError(
            "Reset token is invalid or expired.",
            code="INVALID_RESET_TOKEN",
            status_code=400,
        )
    user.password_hash = hash_password(payload.new_password)
    await users.save(user)
    await auth.revoke_all(user.id)


async def request_verification(
    current_user: User,
    db: AsyncSession,
    users: UserRepository,
) -> dict[str, bool]:
    if not current_user.email_verified:
        await AuthService(db, users).send_one_time_token(
            current_user,
            TokenPurpose.EMAIL_VERIFICATION,
        )
    return {"accepted": True}


async def confirm_verification(
    payload: TokenRequest,
    db: AsyncSession,
    users: UserRepository,
) -> User:
    user = await AuthService(db, users).consume_one_time_token(
        payload.token,
        TokenPurpose.EMAIL_VERIFICATION,
    )
    if not user:
        raise AppError(
            "Verification token is invalid or expired.",
            code="INVALID_VERIFICATION_TOKEN",
            status_code=400,
        )
    user.email_verified = True
    return await users.save(user)
