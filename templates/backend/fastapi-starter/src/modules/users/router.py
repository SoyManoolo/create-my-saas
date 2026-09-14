from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.database import get_db
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.security.tokens import get_current_user
from src.modules.users import service
from src.modules.users.model import User
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import (
    ChangePassword,
    ResetPasswordConfirm,
    ResetPasswordRequest,
    TokenRequest,
    UserPublic,
    UserUpdate,
)


router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserPublic)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserPublic)
async def update_me(
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    users: UserRepository = Depends(get_user_repository),
):
    return await service.update_profile(payload, current_user, users)


@router.post("/me/password", status_code=204)
async def change_password(
    payload: ChangePassword,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    await service.change_password(payload, current_user, db, users)
    return Response(status_code=204)


@router.post("/me/deactivate", status_code=204)
async def deactivate_me(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await service.deactivate(current_user, db)
    return Response(status_code=204)


@router.post("/password-reset/request", status_code=202)
async def request_password_reset(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    return await service.request_password_reset(payload, db, users)


@router.post("/password-reset/confirm", status_code=204)
async def confirm_password_reset(
    payload: ResetPasswordConfirm,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    await service.confirm_password_reset(payload, db, users)
    return Response(status_code=204)


@router.post("/email-verification/request", status_code=202)
async def request_verification(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    return await service.request_verification(current_user, db, users)


@router.post("/email-verification/confirm", response_model=UserPublic)
async def confirm_verification(
    payload: TokenRequest,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    return await service.confirm_verification(payload, db, users)
