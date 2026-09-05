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
        return await self.db.query(User).filter(User.email == email).first()

    async def get_user_by_id(self, user_id: str):
        return await self.db.query(User).filter(User.id == user_id).first()

    async def edit_user(self, id: str, user: User):
        user = await self.get_user_by_id(id)
        if not user:
            return None

        return user

    async def delete_user(self, user_id: str):
        user = await self.get_user_by_id(user_id)
        if user:
            await self.db.delete(user)
            await self.db.commit()
        return 