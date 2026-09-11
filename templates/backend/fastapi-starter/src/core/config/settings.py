"""Environment based settings; the template contains no provider secrets."""
from dataclasses import dataclass
import os

def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}

@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/app")
    secret_key: str = os.getenv("SECRET_KEY", "change-me-in-production")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    redis_url: str | None = os.getenv("REDIS_URL")
    rate_limit_enabled: bool = _bool("RATE_LIMIT_ENABLED")
    rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "60"))
    rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    oauth_enabled: bool = _bool("OAUTH_ENABLED")
    oauth_callback_base_url: str = os.getenv("OAUTH_CALLBACK_BASE_URL", "http://localhost:8000")

settings = Settings()
