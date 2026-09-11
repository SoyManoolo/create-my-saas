from fastapi import APIRouter, Depends, Response
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.database import get_db
from src.core.exceptions import AppError
from src.core.email import EmailDeliveryError
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.security.password import hash_password, verify_password
from src.modules.auth.security.tokens import get_current_user, utc_now
from src.modules.auth.service import AuthService
from src.modules.users.model import Membership, MembershipRole, RefreshToken, TokenPurpose, User
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import ChangePassword, ResetPasswordConfirm, ResetPasswordRequest, TokenRequest, UserPublic, UserUpdate

router = APIRouter(prefix="/users", tags=["users"])
@router.get("/me", response_model=UserPublic)
async def get_me(current_user: User = Depends(get_current_user)): return current_user
@router.patch("/me", response_model=UserPublic)
async def update_me(payload: UserUpdate, current_user: User = Depends(get_current_user), users: UserRepository = Depends(get_user_repository)):
    if payload.name is not None: current_user.name = payload.name
    return await users.save(current_user)
@router.post("/me/password", status_code=204)
async def change_password(payload: ChangePassword, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    if not current_user.password_hash or not verify_password(payload.current_password, current_user.password_hash): raise AppError("Current password is incorrect.", code="INVALID_CREDENTIALS", status_code=401)
    current_user.password_hash = hash_password(payload.new_password); await users.save(current_user); await AuthService(db, users).revoke_all(current_user.id)
    return Response(status_code=204)
@router.post("/me/deactivate", status_code=204)
async def deactivate_me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    # Lock each affected organization's owner memberships before counting them. This
    # serializes two owners trying to deactivate concurrently.
    owned_orgs = (await db.execute(
        select(Membership.organization_id)
        .where(Membership.user_id == current_user.id, Membership.role == MembershipRole.OWNER.value)
        .with_for_update()
    )).scalars().all()
    for organization_id in owned_orgs:
        active_owners = (await db.execute(
            select(Membership.id)
            .join(User, Membership.user_id == User.id)
            .where(Membership.organization_id == organization_id, Membership.role == MembershipRole.OWNER.value, User.is_active.is_(True))
            .with_for_update()
        )).scalars().all()
        if len(active_owners) <= 1:
            raise AppError("Transfer ownership to another active user before deactivating this account.", code="LAST_ACTIVE_OWNER", status_code=409)
    current_user.is_active = False
    await db.execute(update(RefreshToken).where(RefreshToken.user_id == current_user.id, RefreshToken.revoked_at.is_(None)).values(revoked_at=utc_now()))
    await db.commit()
    return Response(status_code=204)
@router.post("/password-reset/request", status_code=202)
async def request_password_reset(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await users.get_user_by_email(str(payload.email))
    if user and user.is_active:
        try:
            await AuthService(db, users).send_one_time_token(user, TokenPurpose.PASSWORD_RESET)
        except EmailDeliveryError:
            # Keep this endpoint indistinguishable from an unknown address. Delivery
            # failures are operational concerns and must not become an enumeration oracle.
            pass
    return {"accepted": True}
@router.post("/password-reset/confirm", status_code=204)
async def confirm_password_reset(payload: ResetPasswordConfirm, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    service = AuthService(db, users); user = await service.consume_one_time_token(payload.token, TokenPurpose.PASSWORD_RESET)
    if not user: raise AppError("Reset token is invalid or expired.", code="INVALID_RESET_TOKEN", status_code=400)
    user.password_hash = hash_password(payload.new_password); await users.save(user); await service.revoke_all(user.id)
    return Response(status_code=204)
@router.post("/email-verification/request", status_code=202)
async def request_verification(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    if not current_user.email_verified: await AuthService(db, users).send_one_time_token(current_user, TokenPurpose.EMAIL_VERIFICATION)
    return {"accepted": True}
@router.post("/email-verification/confirm", response_model=UserPublic)
async def confirm_verification(payload: TokenRequest, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await AuthService(db, users).consume_one_time_token(payload.token, TokenPurpose.EMAIL_VERIFICATION)
    if not user: raise AppError("Verification token is invalid or expired.", code="INVALID_VERIFICATION_TOKEN", status_code=400)
    user.email_verified = True; return await users.save(user)
