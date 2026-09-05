from datetime import datetime, timedelta, timezone
from fastapi import Depends
from modules.users.model import User
from modules.auth.dependencies import oauth2_scheme, get_user_repository
from modules.users.repository import UserRepository
from modules.auth.exceptions import ExpiredTokenError, InvalidAccessTokenError, InactiveUserError
from modules.users.exceptions import UserNotFoundError
import jwt
import os

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = os.environ["ALGORITHM"]
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"])

async def encode_access_token(user_id: str):
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    }
    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM)

def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
        )

    except jwt.ExpiredSignatureError as exc:
        raise ExpiredTokenError() from exc

    except jwt.InvalidTokenError as exc:
        raise InvalidAccessTokenError() from exc

async def get_current_user(token: str = Depends(oauth2_scheme), user_repository: UserRepository = Depends(get_user_repository)) -> User:
    payload = decode_access_token(token)
    user_id: str | None = payload.get("sub")
    if user_id is None:
        raise InvalidAccessTokenError()

    user = await user_repository.get_user_by_id(user_id)
    if user is None:
        raise UserNotFoundError()
    if not user.is_active:
        raise InactiveUserError()

    return user
