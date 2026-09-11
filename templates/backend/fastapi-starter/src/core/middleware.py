from uuid import uuid4
from collections import defaultdict, deque
from time import monotonic

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse
from src.core.config import settings

try:
    from redis.asyncio import from_url as redis_from_url
except ImportError:  # Redis is an optional extra of this template.
    redis_from_url = None


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid4()))

        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            request_id=request_id,
            method=request.method,
            path=request.url.path,
        )

        try:
            response = await call_next(request)
            response.headers["X-Request-ID"] = request_id
            return response
        finally:
            structlog.contextvars.clear_contextvars()


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Configurable in-memory fallback.  Redis is deliberately optional for this starter.
    Production deployments should use an edge rate limiter or replace this store with Redis."""
    def __init__(self, app):
        super().__init__(app); self.requests: dict[str, deque[float]] = defaultdict(deque)
        self.redis = redis_from_url(settings.redis_url, decode_responses=True) if settings.redis_url and redis_from_url else None

    async def dispatch(self, request: Request, call_next):
        if not settings.rate_limit_enabled or request.url.path in {"/health", "/docs", "/openapi.json"}:
            return await call_next(request)
        key = request.headers.get("X-Forwarded-For", request.client.host if request.client else "unknown").split(",")[0].strip()
        if self.redis:
            # Atomic increment plus a first-write expiry makes the limit shared across workers.
            redis_key = f"rate-limit:{key}:{int(monotonic() // settings.rate_limit_window_seconds)}"
            count = await self.redis.incr(redis_key)
            if count == 1: await self.redis.expire(redis_key, settings.rate_limit_window_seconds)
            if count > settings.rate_limit_requests:
                return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "message": "Too many requests."}}, headers={"Retry-After": str(settings.rate_limit_window_seconds)})
            return await call_next(request)
        now = monotonic(); bucket = self.requests[key]; cutoff = now - settings.rate_limit_window_seconds
        while bucket and bucket[0] <= cutoff: bucket.popleft()
        if len(bucket) >= settings.rate_limit_requests:
            return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "message": "Too many requests."}}, headers={"Retry-After": str(settings.rate_limit_window_seconds)})
        bucket.append(now); return await call_next(request)
