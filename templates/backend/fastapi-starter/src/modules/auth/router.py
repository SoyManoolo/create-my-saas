from secrets import compare_digest, token_urlsafe

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.email import EmailDeliveryError
from src.core.exceptions import AppError
from src.db.database import get_db
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.security.password import hash_password, verify_password
from src.modules.auth.security.tokens import get_current_user
from src.modules.auth.service import AuthService
from src.modules.users.model import TokenPurpose, User
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import (
    ChangePassword,
    ResetPasswordConfirm,
    ResetPasswordRequest,
    TokenRequest,
    UserLogin,
    UserPublic,
    UserRegister,
)


router = APIRouter(prefix="/auth", tags=["auth"])


def get_auth_service(db: AsyncSession, users: UserRepository) -> AuthService:
    return AuthService(db, users)


def set_session_cookies(response: Response, refresh_token: str) -> None:
    common = {
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_same_site,
        "max_age": settings.refresh_token_expire_days * 86_400,
    }
    response.set_cookie(
        settings.refresh_cookie_name,
        refresh_token,
        httponly=True,
        path="/auth",
        **common,
    )
    # The CSRF value is not a credential. It must be readable by frontend
    # routes such as / and /account so they can send X-CSRF-Token to /auth.
    response.set_cookie(
        settings.csrf_cookie_name,
        token_urlsafe(32),
        httponly=False,
        path="/",
        **common,
    )


def require_csrf(request: Request) -> None:
    cookie = request.cookies.get(settings.csrf_cookie_name, "")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not cookie or not supplied or not compare_digest(cookie, supplied):
        raise AppError(
            "CSRF token is missing or invalid.",
            code="INVALID_CSRF_TOKEN",
            status_code=403,
        )


def clear_session_cookies(response: Response) -> None:
    common = {
        "secure": settings.cookie_secure,
        "samesite": settings.cookie_same_site,
    }
    response.delete_cookie(settings.refresh_cookie_name, path="/auth", **common)
    response.delete_cookie(settings.csrf_cookie_name, path="/", **common)


@router.post("/register", response_model=UserPublic, status_code=201)
async def register(
    payload: UserRegister,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    auth = get_auth_service(db, users)
    user = await auth.register(payload)
    if not user:
        raise AppError(
            "An account with this email already exists.",
            code="EMAIL_ALREADY_EXISTS",
            status_code=409,
        )
    await auth.send_one_time_token(user, TokenPurpose.EMAIL_VERIFICATION)
    return user


@router.post("/login")
async def login(
    payload: UserLogin,
    response: Response,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    result = await get_auth_service(db, users).login(payload)
    if not result:
        raise AppError(
            "The email or password is incorrect.",
            code="INVALID_CREDENTIALS",
            status_code=401,
        )

    _, (tokens, refresh_token) = result
    set_session_cookies(response, refresh_token)
    return tokens


@router.post("/refresh")
async def refresh(
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    require_csrf(request)
    result = await get_auth_service(db, users).refresh(
        request.cookies.get(settings.refresh_cookie_name, "")
    )
    if not result:
        raise AppError(
            "Refresh token is invalid.",
            code="INVALID_REFRESH_TOKEN",
            status_code=401,
        )

    tokens, refresh_token = result
    set_session_cookies(response, refresh_token)
    return tokens


@router.post("/logout", status_code=204)
async def logout(
    request: Request,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    require_csrf(request)
    await get_auth_service(db, users).revoke(
        request.cookies.get(settings.refresh_cookie_name, "")
    )

    response = Response(status_code=204)
    clear_session_cookies(response)
    return response


# These routes are the backend-neutral browser contract. The established
# /users routes remain available for existing consumers while all frontend
# templates can use the same paths with FastAPI and Nest.
@router.post("/password/reset/request", status_code=204)
async def request_password_reset(
    payload: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    user = await users.get_user_by_email(str(payload.email))
    if user and user.is_active:
        try:
            await get_auth_service(db, users).send_one_time_token(
                user,
                TokenPurpose.PASSWORD_RESET,
            )
        except EmailDeliveryError:
            # Preserve the indistinguishable response for existing and unknown accounts.
            pass
    return Response(status_code=204)


@router.post("/password/reset/confirm", status_code=204)
async def confirm_password_reset(
    payload: ResetPasswordConfirm,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    auth = get_auth_service(db, users)
    user = await auth.consume_one_time_token(payload.token, TokenPurpose.PASSWORD_RESET)
    if not user:
        raise AppError(
            "Reset token is invalid or expired.",
            code="INVALID_RESET_TOKEN",
            status_code=400,
        )

    user.password_hash = hash_password(payload.new_password)
    await users.save(user)
    await auth.revoke_all(user.id)
    return Response(status_code=204)


@router.post("/email/verify", status_code=204)
async def confirm_email_verification(
    payload: TokenRequest,
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    user = await get_auth_service(db, users).consume_one_time_token(
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
    await users.save(user)
    return Response(status_code=204)


@router.post("/email/resend", status_code=204)
async def resend_email_verification(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
    if not current_user.email_verified:
        await get_auth_service(db, users).send_one_time_token(
            current_user,
            TokenPurpose.EMAIL_VERIFICATION,
        )
    return Response(status_code=204)


@router.post("/password/change", status_code=204)
async def change_password(
    payload: ChangePassword,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    users: UserRepository = Depends(get_user_repository),
):
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
    await get_auth_service(db, users).revoke_all(current_user.id)
    return Response(status_code=204)
