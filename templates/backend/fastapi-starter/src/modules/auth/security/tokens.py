from datetime import datetime, timedelta, timezone
from hashlib import sha256
from secrets import token_urlsafe
from uuid import UUID, uuid4
import jwt
from fastapi import Depends
from modules.auth.exceptions import ExpiredTokenError, InvalidAccessTokenError, InactiveUserError
from modules.users.exceptions import UserNotFoundError
from modules.auth.dependencies import oauth2_scheme, get_user_repository
from modules.users.repository import UserRepository
from modules.users.model import User
from core.config import settings

def utc_now() -> datetime: return datetime.now(timezone.utc)
def opaque_token() -> str: return token_urlsafe(48)
def token_hash(value: str) -> str: return sha256(value.encode()).hexdigest()

def encode_access_token(user_id: UUID | str) -> str:
    return jwt.encode({"sub": str(user_id), "type": "access", "jti": uuid4().hex,
        "exp": utc_now() + timedelta(minutes=settings.access_token_expire_minutes)}, settings.secret_key, algorithm=settings.jwt_algorithm)

def decode_access_token(token: str) -> dict:
    try:
        data = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
        if data.get("type") != "access" or not data.get("sub"): raise InvalidAccessTokenError()
        return data
    except jwt.ExpiredSignatureError as exc: raise ExpiredTokenError() from exc
    except jwt.InvalidTokenError as exc: raise InvalidAccessTokenError() from exc

async def get_current_user(token: str = Depends(oauth2_scheme), user_repository: UserRepository = Depends(get_user_repository)) -> User:
    user = await user_repository.get_user_by_id(decode_access_token(token)["sub"])
    if not user: raise UserNotFoundError()
    if not user.is_active: raise InactiveUserError()
    return user
