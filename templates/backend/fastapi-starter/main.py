from fastapi import FastAPI
from modules.auth.router import router as auth_router
from core.exceptions import AppError
from core.exception_handlers import app_error_handler
from core.logging import configure_logging
from core.middleware import RequestContextMiddleware

configure_logging()

app = FastAPI(title="FastAPI Starter", description="A starter template for FastAPI applications", version="1.0.0")
app.add_exception_handler(AppError, app_error_handler)
app.add_middleware(RequestContextMiddleware)

@app.get("/")
def read_root():
    return {"message": "Running successfully!"}

app.include_router(auth_router)