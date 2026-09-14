from uuid import uuid4
from collections import defaultdict, deque
from time import monotonic, time

import structlog
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.responses import JSONResponse
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


def _rate_limit_policy(request: Request) -> tuple[str, int, int]:
    auth_bucket = SENSITIVE_AUTH_BUCKETS.get((request.method, request.url.path))
    if auth_bucket:
        return auth_bucket, settings.auth_rate_limit_requests, settings.auth_rate_limit_window_seconds
    return (
        f"route:{request.method}:{request.url.path}",
        settings.rate_limit_requests,
        settings.rate_limit_window_seconds,
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
        super().__init__(app); self.requests: dict[str, deque[float]] = defaultdict(deque)
        self.redis = redis_from_url(settings.redis_url, decode_responses=True) if settings.redis_url and redis_from_url else None

    async def dispatch(self, request: Request, call_next):
        if not settings.rate_limit_enabled or request.url.path in {"/health", "/ready", "/docs", "/openapi.json"}:
            return await call_next(request)
        # ProxyHeadersMiddleware rewrites client only when its immediate peer is
        # listed in TRUSTED_PROXY_IPS. Otherwise this remains the socket address.
        bucket_name, limit, window_seconds = _rate_limit_policy(request)
        client_ip = request.client.host if request.client else "unknown"
        key = f"{bucket_name}:{client_ip}"
        if settings.environment in {"production", "staging"} and not self.redis:
            return JSONResponse(status_code=503, content={"error": {"code": "RATE_LIMIT_UNAVAILABLE", "message": "Request limiting is temporarily unavailable."}}, headers={"Retry-After": "60"})
        if self.redis:
            # Wall-clock windows make a Redis key stable across processes and hosts.
            redis_key = f"{settings.rate_limit_prefix}:{key}:{int(time() // window_seconds)}"
            try:
                # The expiry is established atomically with the increment. A
                # process crash cannot leave an unbounded counter behind.
                count = await self.redis.eval(
                    "local count = redis.call('INCR', KEYS[1]); "
                    "if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; "
                    "return count",
                    1,
                    redis_key,
                    window_seconds,
                )
            except Exception:
                if settings.environment in {"production", "staging"}:
                    return JSONResponse(status_code=503, content={"error": {"code": "RATE_LIMIT_UNAVAILABLE", "message": "Request limiting is temporarily unavailable."}}, headers={"Retry-After": "60"})
                self.redis = None
                return await self.dispatch(request, call_next)
            if count > limit:
                return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "message": "Too many requests."}}, headers={"Retry-After": str(window_seconds)})
            return await call_next(request)
        now = monotonic(); bucket = self.requests[key]; cutoff = now - window_seconds
        while bucket and bucket[0] <= cutoff: bucket.popleft()
        if len(bucket) >= limit:
            return JSONResponse(status_code=429, content={"error": {"code": "RATE_LIMITED", "message": "Too many requests."}}, headers={"Retry-After": str(window_seconds)})
        bucket.append(now); return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Baseline browser protections for the API and its authentication responses."""
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("Content-Security-Policy", "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        response.headers.setdefault("Cross-Origin-Resource-Policy", "same-site")
        response.headers.setdefault("Permissions-Policy", "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        if settings.environment in {"production", "staging"}:
            response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
        if request.url.path.startswith("/auth"):
            response.headers.setdefault("Cache-Control", "no-store")
            response.headers.setdefault("Pragma", "no-cache")
        return response
