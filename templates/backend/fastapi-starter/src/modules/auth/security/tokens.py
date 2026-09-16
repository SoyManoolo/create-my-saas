from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID, uuid4

import jwt
from fastapi import Depends

from src.core.config import settings
from src.modules.auth.dependencies import get_user_repository, oauth2_scheme
from src.modules.auth.exceptions import (
    ExpiredTokenError,
    InactiveUserError,
    InvalidAccessTokenError,
)
from src.modules.users.exceptions import UserNotFoundError
from src.modules.users.model import User
from src.modules.users.repository import UserRepository


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def opaque_token() -> str:
    return token_urlsafe(48)


def token_hash(value: str) -> str:
    return sha256(value.encode()).hexdigest()


def encode_access_token(user_id: UUID | str) -> str:
    payload = {
        "sub": str(user_id),
        "type": "access",
        "jti": uuid4().hex,
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "exp": utc_now() + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(
        payload,
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_access_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
        )
        if payload.get("type") != "access" or not payload.get("sub"):
            raise InvalidAccessTokenError()
        return payload
    except jwt.ExpiredSignatureError as error:
        raise ExpiredTokenError() from error
    except jwt.InvalidTokenError as error:
        raise InvalidAccessTokenError() from error


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    user_repository: UserRepository = Depends(get_user_repository),
) -> User:
    payload = decode_access_token(token)
    user = await user_repository.get_user_by_id(payload["sub"])
    if not user:
        raise UserNotFoundError()
    if not user.is_active:
        raise InactiveUserError()
    return user
