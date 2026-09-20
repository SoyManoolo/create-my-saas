import asyncio
from collections import defaultdict, deque
from time import monotonic, time
from uuid import uuid4

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from src.core.config import settings

try:
    from redis.asyncio import from_url as redis_from_url
except ImportError:  # Redis is an optional extra of this template.
    redis_from_url = None


SENSITIVE_AUTH_BUCKETS = {
    ("POST", "/auth/register"): "auth:register",
    ("POST", "/auth/login"): "auth:login",
    ("POST", "/auth/password/reset/request"): "auth:password-reset-request",
    ("POST", "/auth/password/reset/confirm"): "auth:password-reset-confirm",
}

SKIPPED_RATE_LIMIT_PATHS = {"/health", "/ready", "/docs", "/openapi.json"}
REDIS_COMMAND_TIMEOUT_SECONDS = 0.3
REDIS_RETRY_DELAY_SECONDS = 0.25


def _rate_limit_policy(request: Request) -> tuple[str, int, int]:
    auth_bucket = SENSITIVE_AUTH_BUCKETS.get((request.method, request.url.path))
    if auth_bucket:
        return (
            auth_bucket,
            settings.auth_rate_limit_requests,
            settings.auth_rate_limit_window_seconds,
        )
    return (
        f"route:{request.method}:{request.url.path}",
        settings.rate_limit_requests,
        settings.rate_limit_window_seconds,
    )


def _rate_limit_response(
    status_code: int,
    code: str,
    message: str,
    retry_after: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers={"Retry-After": retry_after},
    )


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("X-Request-ID", str(uuid4()))
        if len(request_id) > 128 or not request_id.isprintable():
            request_id = str(uuid4())

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
    """A Redis-backed, cross-worker limiter with a development-only local fallback."""

    def __init__(self, app):
        super().__init__(app)
        self.requests: dict[str, deque[float]] = defaultdict(deque)
        self.redis = None
        self._redis_retry_after = 0.0

    async def dispatch(self, request: Request, call_next):
        if (
            not settings.rate_limit_enabled
            or request.url.path in SKIPPED_RATE_LIMIT_PATHS
        ):
            return await call_next(request)

        # ProxyHeadersMiddleware rewrites client only when its immediate peer is
        # listed in TRUSTED_PROXY_IPS. Otherwise this remains the socket address.
        bucket_name, limit, window_seconds = _rate_limit_policy(request)
        client_ip = request.client.host if request.client else "unknown"
        key = f"{bucket_name}:{client_ip}"

        redis = self._redis_client()
        if self._requires_redis() and not redis:
            return self._unavailable_response()

        if redis:
            rate_limited = await self._is_redis_rate_limited(
                key,
                window_seconds,
            )
            if rate_limited is None:
                if self._requires_redis():
                    return self._unavailable_response()
            elif rate_limited > limit:
                return self._limited_response(window_seconds)
            else:
                return await call_next(request)

        if self._is_local_rate_limited(key, limit, window_seconds):
            return self._limited_response(window_seconds)
        return await call_next(request)

    @staticmethod
    def _requires_redis() -> bool:
        return settings.environment in {"production", "staging"}

    @staticmethod
    def _unavailable_response() -> JSONResponse:
        return _rate_limit_response(
            503,
            "RATE_LIMIT_UNAVAILABLE",
            "Request limiting is temporarily unavailable.",
            "60",
        )

    @staticmethod
    def _limited_response(window_seconds: int) -> JSONResponse:
        return _rate_limit_response(
            429,
            "RATE_LIMITED",
            "Too many requests.",
            str(window_seconds),
        )

    def _redis_client(self):
        if (
            self.redis
            or not settings.redis_url
            or not redis_from_url
            or monotonic() < self._redis_retry_after
        ):
            return self.redis
        self.redis = redis_from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=REDIS_COMMAND_TIMEOUT_SECONDS,
            socket_timeout=REDIS_COMMAND_TIMEOUT_SECONDS,
            health_check_interval=15,
        )
        return self.redis

    async def close(self) -> None:
        await self._discard_redis_client(retry=False)

    async def _discard_redis_client(self, retry: bool = True) -> None:
        client, self.redis = self.redis, None
        self._redis_retry_after = monotonic() + REDIS_RETRY_DELAY_SECONDS if retry else 0.0
        close = getattr(client, "aclose", None)
        if close:
            try:
                await close()
            except Exception:
                pass

    async def _is_redis_rate_limited(
        self,
        key: str,
        window_seconds: int,
    ) -> int | None:
        # Wall-clock windows make a Redis key stable across processes and hosts.
        redis_key = (
            f"{settings.rate_limit_prefix}:{key}:"
            f"{int(time() // window_seconds)}"
        )
        client = self._redis_client()
        if not client:
            return None
        try:
            # The expiry is established atomically with the increment. A process
            # crash cannot leave an unbounded counter behind.
            return await asyncio.wait_for(
                client.eval(
                    "local count = redis.call('INCR', KEYS[1]); "
                    "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; "
                    "return count",
                    1,
                    redis_key,
                    window_seconds,
                ),
                timeout=REDIS_COMMAND_TIMEOUT_SECONDS,
            )
        except Exception:
            # Development falls back to its in-process limiter; production and
            # staging fail closed in dispatch.
            await self._discard_redis_client()
            return None

    def _is_local_rate_limited(
        self,
        key: str,
        limit: int,
        window_seconds: int,
    ) -> bool:
        now = monotonic()
        bucket = self.requests[key]
        cutoff = now - window_seconds
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

        if len(bucket) >= limit:
            return True
        bucket.append(now)
        return False


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline browser protections for the API and its authentication responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'none'; base-uri 'none'; form-action 'none'; "
            "frame-ancestors 'none'",
        )
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        response.headers.setdefault(
            "Permissions-Policy",
            "accelerometer=(), camera=(), geolocation=(), microphone=(), "
            "payment=(), usb=()",
        )
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")

        if settings.environment in {"production", "staging"}:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=63072000; includeSubDomains",
            )
        if request.url.path.startswith("/auth"):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Pragma", "no-cache")
        return response
