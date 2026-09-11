"""Environment based settings; production settings fail closed."""
from dataclasses import dataclass
import os
from urllib.parse import urlparse

def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}

@dataclass(frozen=True)
class Settings:
    environment: str = os.getenv("APP_ENV", "development").strip().lower()
    database_url: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/app")
    database_ssl: bool = _bool("DATABASE_SSL")
    secret_key: str = os.getenv("SECRET_KEY", "development-only-secret-not-for-production-32b")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_issuer: str = os.getenv("JWT_ISSUER", "fastapi-starter")
    jwt_audience: str = os.getenv("JWT_AUDIENCE", "fastapi-starter-api")
    access_token_expire_minutes: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
    refresh_token_expire_days: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))
    refresh_cookie_name: str = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")
    csrf_cookie_name: str = os.getenv("CSRF_COOKIE_NAME", "csrf_token")
    cookie_secure: bool = _bool("COOKIE_SECURE")
    cookie_same_site: str = os.getenv("COOKIE_SAME_SITE", "lax").strip().lower()
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:3000")
    cors_origins_raw: str = os.getenv("CORS_ORIGINS", os.getenv("FRONTEND_URL", "http://localhost:3000"))
    redis_url: str | None = os.getenv("REDIS_URL")
    rate_limit_enabled: bool = _bool("RATE_LIMIT_ENABLED", True)
    rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", "30"))
    rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    oauth_enabled: bool = _bool("OAUTH_ENABLED")
    oauth_callback_base_url: str = os.getenv("OAUTH_CALLBACK_BASE_URL", "http://localhost:8000")
    smtp_host: str | None = os.getenv("SMTP_HOST")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_username: str | None = os.getenv("SMTP_USERNAME")
    smtp_password: str | None = os.getenv("SMTP_PASSWORD")
    smtp_from: str | None = os.getenv("SMTP_FROM")
    smtp_use_ssl: bool = _bool("SMTP_USE_SSL")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def smtp_configured(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_from))

    def validate(self) -> None:
        if self.environment not in {"production", "staging"}:
            return
        if len(self.secret_key) < 32 or self.secret_key in {"development-only-secret-not-for-production-32b", "change-me-in-production", "replace-with-a-long-random-secret"}:
            raise RuntimeError("SECRET_KEY must be a unique value of at least 32 characters in production.")
        if not self.database_url or "localhost" in self.database_url:
            raise RuntimeError("DATABASE_URL must point to the production database.")
        if not self.database_ssl:
            raise RuntimeError("DATABASE_SSL must be enabled in production.")
        if not self.cors_origins or any(urlparse(origin).scheme != "https" for origin in self.cors_origins):
            raise RuntimeError("CORS_ORIGINS must contain explicit HTTPS origins in production.")
        if not self.smtp_configured:
            raise RuntimeError("SMTP_HOST, SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM are required in production.")
        if not self.cookie_secure:
            raise RuntimeError("COOKIE_SECURE must be enabled in production.")
        if not self.rate_limit_enabled or not self.redis_url or urlparse(self.redis_url).scheme != "rediss":
            raise RuntimeError("RATE_LIMIT_ENABLED and a TLS REDIS_URL (rediss://) are required in production.")
        if self.cookie_same_site not in {"lax", "strict", "none"}:
            raise RuntimeError("COOKIE_SAME_SITE must be lax, strict or none.")
        if self.cookie_same_site == "none" and not self.cookie_secure:
            raise RuntimeError("COOKIE_SECURE is required when COOKIE_SAME_SITE is none.")
        if self.smtp_port not in {465, 587}:
            raise RuntimeError("SMTP_PORT must be 465 (TLS) or 587 (STARTTLS).")
        if self.smtp_port == 465 and not self.smtp_use_ssl:
            raise RuntimeError("SMTP_USE_SSL must be enabled when SMTP_PORT is 465.")

settings = Settings()
