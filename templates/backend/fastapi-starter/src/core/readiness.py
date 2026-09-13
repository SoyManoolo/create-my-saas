import asyncio
from collections.abc import Awaitable, Callable
from typing import Literal

from redis.asyncio import from_url as redis_from_url
from sqlalchemy import text

from src.core.config import settings
from src.db.database import engine

DependencyStatus = Literal["ok", "unavailable", "disabled"]
READINESS_TIMEOUT_SECONDS = 0.5


async def _database_ready() -> None:
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))


async def _redis_ready() -> None:
    if not settings.redis_url:
        raise RuntimeError("REDIS_URL is not configured")
    client = redis_from_url(settings.redis_url, decode_responses=True)
    try:
        await client.ping()
    finally:
        await client.aclose()


async def _probe(check: Callable[[], Awaitable[None]]) -> DependencyStatus:
    try:
        await asyncio.wait_for(check(), timeout=READINESS_TIMEOUT_SECONDS)
        return "ok"
    except Exception:
        return "unavailable"


async def readiness_checks() -> dict[str, DependencyStatus]:
    database = asyncio.create_task(_probe(_database_ready))
    redis = asyncio.create_task(_probe(_redis_ready)) if settings.rate_limit_enabled else None
    return {
        "database": await database,
        "redis": await redis if redis else "disabled",
    }
