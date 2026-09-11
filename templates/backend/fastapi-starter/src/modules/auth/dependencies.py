from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from src.db.database import get_db
from src.modules.users.repository import UserRepository

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
async def get_user_repository(db: AsyncSession = Depends(get_db)) -> UserRepository: return UserRepository(db)
