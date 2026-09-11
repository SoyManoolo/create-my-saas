from fastapi import FastAPI
from modules.auth.router import router as auth_router
from modules.auth.oauth import router as oauth_router
from modules.users.router import router as users_router
from modules.organizations.router import router as organizations_router
from modules.billing.router import router as billing_router
from core.exceptions import AppError
from core.exception_handlers import app_error_handler
from core.logging import configure_logging
from core.middleware import RequestContextMiddleware, RateLimitMiddleware

configure_logging()

app = FastAPI(title="FastAPI Starter", description="A starter template for FastAPI applications", version="1.0.0")
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(RequestContextMiddleware)
app.add_middleware(RateLimitMiddleware)

@app.get("/")
def read_root():
    return {"message": "Running successfully!"}

@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}

app.include_router(auth_router)
app.include_router(oauth_router)
app.include_router(users_router)
app.include_router(organizations_router)
app.include_router(billing_router)
