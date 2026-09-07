import os
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

DATABASE_URL = os.environ["DATABASE_URL"]

engine = create_async_engine(DATABASE_URL)

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)
async def get_db():
    db: AsyncSession = SessionLocal()
    try:
        yield db
    finally:
        await db.close()