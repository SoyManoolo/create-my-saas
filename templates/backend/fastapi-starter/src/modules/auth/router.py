from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.database import get_db
from src.core.exceptions import AppError
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.service import AuthService
from src.modules.users.model import TokenPurpose
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import UserLogin, UserRegister, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])
def service(db: AsyncSession, users: UserRepository) -> AuthService: return AuthService(db, users)

@router.post("/register", response_model=UserPublic, status_code=201)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await service(db, users).register(payload)
    if not user: raise AppError("An account with this email already exists.", code="EMAIL_ALREADY_EXISTS", status_code=409)
    await service(db, users).send_one_time_token(user, TokenPurpose.EMAIL_VERIFICATION)
    return user

@router.post("/login")
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    result = await service(db, users).login(payload)
    if not result: raise AppError("The email or password is incorrect.", code="INVALID_CREDENTIALS", status_code=401)
    _, tokens = result; return tokens

@router.post("/refresh")
async def refresh(payload: dict, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    raw = payload.get("refresh_token", ""); result = await service(db, users).refresh(raw)
    if not result: raise AppError("Refresh token is invalid.", code="INVALID_REFRESH_TOKEN", status_code=401)
    return result

@router.post("/logout", status_code=204)
async def logout(payload: dict, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    await service(db, users).revoke(payload.get("refresh_token", "")); return Response(status_code=204)
