from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from db.database import get_db
from core.exceptions import AppError
from modules.auth.dependencies import get_user_repository
from modules.auth.security.password import hash_password, verify_password
from modules.auth.security.tokens import get_current_user
from modules.auth.service import AuthService
from modules.users.model import TokenPurpose, User
from modules.users.repository import UserRepository
from modules.users.schemas import ChangePassword, ResetPasswordConfirm, ResetPasswordRequest, TokenRequest, UserPublic, UserUpdate

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
    current_user.is_active = False; await users.save(current_user); await AuthService(db, users).revoke_all(current_user.id)
    return Response(status_code=204)
@router.post("/password-reset/request", status_code=202)
async def request_password_reset(payload: ResetPasswordRequest, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await users.get_user_by_email(str(payload.email)); token = None
    if user and user.is_active: token = await AuthService(db, users).create_one_time_token(user, TokenPurpose.PASSWORD_RESET)
    return {"accepted": True, "reset_token": token}  # inject a mail adapter in production
@router.post("/password-reset/confirm", status_code=204)
async def confirm_password_reset(payload: ResetPasswordConfirm, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    service = AuthService(db, users); user = await service.consume_one_time_token(payload.token, TokenPurpose.PASSWORD_RESET)
    if not user: raise AppError("Reset token is invalid or expired.", code="INVALID_RESET_TOKEN", status_code=400)
    user.password_hash = hash_password(payload.new_password); await users.save(user); await service.revoke_all(user.id)
    return Response(status_code=204)
@router.post("/email-verification/request", status_code=202)
async def request_verification(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    token = None if current_user.email_verified else await AuthService(db, users).create_one_time_token(current_user, TokenPurpose.EMAIL_VERIFICATION)
    return {"accepted": True, "verification_token": token}
@router.post("/email-verification/confirm", response_model=UserPublic)
async def confirm_verification(payload: TokenRequest, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await AuthService(db, users).consume_one_time_token(payload.token, TokenPurpose.EMAIL_VERIFICATION)
    if not user: raise AppError("Verification token is invalid or expired.", code="INVALID_VERIFICATION_TOKEN", status_code=400)
    user.email_verified = True; return await users.save(user)
