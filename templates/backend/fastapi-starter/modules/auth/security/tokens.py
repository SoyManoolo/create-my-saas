from datetime import datetime, timedelta, timezone
from fastapi import Depends
from modules.users.model import User
from modules.auth.dependencies import oauth2_scheme, get_user_repository
from modules.users.repository import UserRepository
import jwt
import os

SECRET_KEY = os.environ["SECRET_KEY"]
ALGORITHM = os.environ["ALGORITHM"]
ACCES_TOKEN_EXPIRE_MINUTES = int(os.environ["ACCESS_TOKEN_EXPIRE_MINUTES"])

async def encode_access_token(user_id: str):
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCES_TOKEN_EXPIRE_MINUTES)
    }
    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM)

async def decode_access_token(token: str):
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

async def get_current_user(token: str = Depends(oauth2_scheme), user_repository: UserRepository = Depends(get_user_repository)) -> User:
    payload = await decode_access_token(token)
    user_id: str = payload.get("sub")
    user = await user_repository.get_user_by_id(user_id)

    if user is None:
        return None

    if not user.is_active:
        return None

    return user