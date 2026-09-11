from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.modules.users.model import User

class UserRepository:
    def __init__(self, db: AsyncSession): self.db = db
    async def create_user(self, user: User) -> User:
        self.db.add(user); await self.db.commit(); await self.db.refresh(user); return user
    async def get_user_by_email(self, email: str) -> User | None:
        return (await self.db.execute(select(User).where(User.email == email.lower()))).scalar_one_or_none()
    async def get_user_by_id(self, user_id: UUID | str) -> User | None: return await self.db.get(User, user_id)
    async def save(self, user: User) -> User:
        await self.db.commit(); await self.db.refresh(user); return user
