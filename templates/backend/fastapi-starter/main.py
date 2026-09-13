from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from src.modules.auth.router import router as auth_router
from src.modules.auth.oauth import router as oauth_router
from src.modules.users.router import router as users_router
from src.modules.organizations.router import router as organizations_router
from src.modules.billing.router import router as billing_router
from src.core.config import settings
from src.core.exceptions import AppError
from src.core.exception_handlers import app_error_handler, request_validation_error_handler
from src.core.logging import configure_logging
from src.core.middleware import RequestContextMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from src.core.readiness import readiness_checks
from src.db.database import close_database

configure_logging()

@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.validate()
    try:
        yield
    finally:
        await close_database()


is_production = settings.environment in {"production", "staging"}
app = FastAPI(title="FastAPI Starter", description="A starter template for FastAPI applications", version="1.0.0", lifespan=lifespan, docs_url=None if is_production else "/docs", redoc_url=None if is_production else "/redoc", openapi_url=None if is_production else "/openapi.json")
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestValidationError, request_validation_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-Request-ID"],
)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
# Forwarded headers are accepted only from the explicit reverse proxies above.
# This middleware must wrap the limiter so request.client is the validated client IP.
if settings.trust_proxy_headers:
    app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=settings.trusted_proxy_ips)

@app.get("/")
def read_root():
    return {"message": "Running successfully!"}

@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}

@app.get("/ready", tags=["health"])
async def ready():
    checks = await readiness_checks()
    if "unavailable" in checks.values():
        return JSONResponse(
            status_code=503,
            content={
                "status": "not_ready",
                "checks": checks,
                "error": {
                    "code": "SERVICE_NOT_READY",
                    "message": "One or more required dependencies are unavailable.",
                },
            },
        )
    return {"status": "ready", "checks": checks}

app.include_router(auth_router)
app.include_router(oauth_router)
app.include_router(users_router)
app.include_router(organizations_router)
app.include_router(billing_router)
