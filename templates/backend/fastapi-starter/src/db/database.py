from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
import ssl
from src.core.config import settings

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    connect_args={"ssl": ssl.create_default_context()} if settings.database_ssl else {},
)

SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
)
async def get_db():
    async with SessionLocal() as db:
        yield db
