"""Environment based settings; production settings fail closed."""
from dataclasses import dataclass
import json
import os
from urllib.parse import urlparse

def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}

@dataclass(frozen=True)
class Settings:
    # APP_ENV is the cross-backend name. NODE_ENV remains an alias so existing
    # deployment manifests keep working while they are migrated.
    environment: str = os.getenv("APP_ENV", os.getenv("NODE_ENV", "development")).strip().lower()
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
    rate_limit_requests: int = int(os.getenv("RATE_LIMIT_REQUESTS", os.getenv("RATE_LIMIT_MAX", "30")))
    rate_limit_window_seconds: int = int(os.getenv("RATE_LIMIT_WINDOW_SECONDS", "60"))
    rate_limit_prefix: str = os.getenv("RATE_LIMIT_PREFIX", "rate-limit").strip() or "rate-limit"
    trust_proxy_headers: bool = _bool("TRUST_PROXY_HEADERS")
    trusted_proxy_ips_raw: str = os.getenv("TRUSTED_PROXY_IPS", "")
    oauth_enabled: bool = _bool("OAUTH_ENABLED")
    oauth_callback_base_url: str = os.getenv("OAUTH_CALLBACK_BASE_URL", "http://localhost:8000")
    smtp_host: str | None = os.getenv("SMTP_HOST")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_username: str | None = os.getenv("SMTP_USERNAME")
    smtp_password: str | None = os.getenv("SMTP_PASSWORD")
    smtp_from: str | None = os.getenv("SMTP_FROM")
    smtp_use_ssl: bool = _bool("SMTP_USE_SSL")
    stripe_secret_key: str | None = os.getenv("STRIPE_SECRET_KEY") or None
    stripe_webhook_secret: str | None = os.getenv("STRIPE_WEBHOOK_SECRET") or None
    stripe_price_plans: str = os.getenv("STRIPE_PRICE_PLANS", "{}")
    billing_free_entitlements: str = os.getenv("BILLING_FREE_ENTITLEMENTS", "{}")
    stripe_portal_configuration_id: str | None = os.getenv("STRIPE_PORTAL_CONFIGURATION_ID") or None
    stripe_usage_event_name: str | None = os.getenv("STRIPE_USAGE_EVENT_NAME") or None
    stripe_webhook_tolerance_seconds: int = int(os.getenv("STRIPE_WEBHOOK_TOLERANCE_SECONDS", "300"))

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def trusted_proxy_ips(self) -> list[str]:
        return [address.strip() for address in self.trusted_proxy_ips_raw.split(",") if address.strip()]

    @property
    def smtp_configured(self) -> bool:
        return all((self.smtp_host, self.smtp_username, self.smtp_password, self.smtp_from))

    def validate(self) -> None:
        database_scheme = urlparse(self.database_url).scheme
        if database_scheme != "postgresql+asyncpg":
            raise RuntimeError("DATABASE_URL must use the postgresql+asyncpg driver.")
        if self.rate_limit_requests < 1 or self.rate_limit_window_seconds < 1:
            raise RuntimeError("RATE_LIMIT_REQUESTS and RATE_LIMIT_WINDOW_SECONDS must be positive integers.")
        if bool(self.stripe_secret_key) != bool(self.stripe_webhook_secret):
            raise RuntimeError("STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together.")
        if self.stripe_webhook_tolerance_seconds < 1:
            raise RuntimeError("STRIPE_WEBHOOK_TOLERANCE_SECONDS must be positive.")
        try:
            stripe_price_plans = json.loads(self.stripe_price_plans)
            free_entitlements = json.loads(self.billing_free_entitlements)
        except json.JSONDecodeError as error:
            raise RuntimeError("STRIPE_PRICE_PLANS and BILLING_FREE_ENTITLEMENTS must be valid JSON.") from error
        if not isinstance(stripe_price_plans, dict) or not isinstance(free_entitlements, dict):
            raise RuntimeError("STRIPE_PRICE_PLANS and BILLING_FREE_ENTITLEMENTS must be JSON objects.")
        if self.stripe_secret_key and not stripe_price_plans:
            raise RuntimeError("STRIPE_PRICE_PLANS must contain at least one plan when Stripe is configured.")
        if self.trust_proxy_headers and not self.trusted_proxy_ips:
            raise RuntimeError("TRUSTED_PROXY_IPS is required when TRUST_PROXY_HEADERS is enabled.")
        if "*" in self.trusted_proxy_ips:
            raise RuntimeError("TRUSTED_PROXY_IPS must list explicit proxy addresses; '*' is not allowed.")
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
