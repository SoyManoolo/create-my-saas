from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from db.database import get_db
from auth.service import AuthService
from users.repository import UserRepository


async def get_auth_service(db: AsyncSession = Depends(get_db)) -> AuthService:
    user_repository = UserRepository(db)
    return AuthService(user_repository)