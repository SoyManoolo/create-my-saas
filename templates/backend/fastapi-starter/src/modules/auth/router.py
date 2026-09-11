from secrets import compare_digest, token_urlsafe
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.database import get_db
from src.core.config import settings
from src.core.exceptions import AppError
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.service import AuthService
from src.modules.users.model import TokenPurpose
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import UserLogin, UserRegister, UserPublic

router = APIRouter(prefix="/auth", tags=["auth"])
def service(db: AsyncSession, users: UserRepository) -> AuthService: return AuthService(db, users)

def set_session_cookies(response: Response, refresh_token: str) -> None:
    common = {"path": "/auth", "secure": settings.cookie_secure, "samesite": settings.cookie_same_site, "max_age": settings.refresh_token_expire_days * 86_400}
    response.set_cookie(settings.refresh_cookie_name, refresh_token, httponly=True, **common)
    response.set_cookie(settings.csrf_cookie_name, token_urlsafe(32), httponly=False, **common)

def require_csrf(request: Request) -> None:
    cookie = request.cookies.get(settings.csrf_cookie_name, "")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not cookie or not supplied or not compare_digest(cookie, supplied):
        raise AppError("CSRF token is missing or invalid.", code="INVALID_CSRF_TOKEN", status_code=403)

def clear_session_cookies(response: Response) -> None:
    common = {"path": "/auth", "secure": settings.cookie_secure, "samesite": settings.cookie_same_site}
    response.delete_cookie(settings.refresh_cookie_name, **common)
    response.delete_cookie(settings.csrf_cookie_name, **common)

@router.post("/register", response_model=UserPublic, status_code=201)
async def register(payload: UserRegister, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    user = await service(db, users).register(payload)
    if not user: raise AppError("An account with this email already exists.", code="EMAIL_ALREADY_EXISTS", status_code=409)
    await service(db, users).send_one_time_token(user, TokenPurpose.EMAIL_VERIFICATION)
    return user

@router.post("/login")
async def login(payload: UserLogin, response: Response, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    result = await service(db, users).login(payload)
    if not result: raise AppError("The email or password is incorrect.", code="INVALID_CREDENTIALS", status_code=401)
    _, (tokens, refresh_token) = result
    set_session_cookies(response, refresh_token)
    return tokens

@router.post("/refresh")
async def refresh(request: Request, response: Response, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    require_csrf(request)
    result = await service(db, users).refresh(request.cookies.get(settings.refresh_cookie_name, ""))
    if not result: raise AppError("Refresh token is invalid.", code="INVALID_REFRESH_TOKEN", status_code=401)
    tokens, refresh_token = result
    set_session_cookies(response, refresh_token)
    return tokens

@router.post("/logout", status_code=204)
async def logout(request: Request, db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    require_csrf(request)
    await service(db, users).revoke(request.cookies.get(settings.refresh_cookie_name, ""))
    response = Response(status_code=204); clear_session_cookies(response); return response
