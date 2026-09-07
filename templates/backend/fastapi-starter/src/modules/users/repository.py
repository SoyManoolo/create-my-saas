from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from modules.users.model import User

class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def create_user(self, user: User):
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return user

    async def get_user_by_email(self, email: str):
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_user_by_id(self, user_id: UUID):
        result = await self.db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def edit_user(self, user_id: UUID):
        user = await self.get_user_by_id(user_id)
        if not user:
            return None

        return user

    async def delete_user(self, user_id: UUID):
        user = await self.get_user_by_id(user_id)
        if user:
            await self.db.delete(user)
            await self.db.commit()
        return 