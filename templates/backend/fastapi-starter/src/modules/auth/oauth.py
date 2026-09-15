"""Google and GitHub authorization-code OAuth with server-side PKCE."""
import asyncio
import json
import os
from base64 import urlsafe_b64encode
from dataclasses import dataclass
from datetime import timedelta
from hashlib import sha256
from secrets import token_urlsafe
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as UrlRequest, urlopen

from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.exceptions import AppError
from src.db.database import get_db
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.router import set_session_cookies
from src.modules.auth.security.tokens import token_hash, utc_now
from src.modules.auth.service import AuthService
from src.modules.users.model import OAuthState
from src.modules.users.repository import UserRepository

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])
SUPPORTED_PROVIDERS = {"google", "github"}


@dataclass(frozen=True)
class OAuthProfile:
    email: str
    name: str
    provider_account_id: str


def _provider_env(provider: str, name: str, default: str | None = None) -> str | None:
    if provider not in SUPPORTED_PROVIDERS:
        return None
    return os.getenv(f"OAUTH_{provider.upper()}_{name}", default)


def _provider_config(provider: str) -> dict[str, str] | None:
    defaults = {
        "google": {"AUTHORIZATION_URL": "https://accounts.google.com/o/oauth2/v2/auth", "TOKEN_URL": "https://oauth2.googleapis.com/token", "USERINFO_URL": "https://openidconnect.googleapis.com/v1/userinfo", "SCOPES": "openid email profile"},
        "github": {"AUTHORIZATION_URL": "https://github.com/login/oauth/authorize", "TOKEN_URL": "https://github.com/login/oauth/access_token", "USERINFO_URL": "https://api.github.com/user", "SCOPES": "read:user user:email"},
    }.get(provider)
    if not defaults or not settings.oauth_enabled:
        return None
    client_id = _provider_env(provider, "CLIENT_ID")
    client_secret = _provider_env(provider, "CLIENT_SECRET")
    redirect_uri = _provider_env(provider, "REDIRECT_URI") or f"{settings.oauth_callback_base_url.rstrip('/')}/auth/oauth/{provider}/callback"
    if not client_id or not client_secret:
        return None
    return {
        "client_id": client_id, "client_secret": client_secret, "redirect_uri": redirect_uri,
        "authorization_url": _provider_env(provider, "AUTHORIZATION_URL", defaults["AUTHORIZATION_URL"]) or "",
        "token_url": _provider_env(provider, "TOKEN_URL", defaults["TOKEN_URL"]) or "",
        "userinfo_url": _provider_env(provider, "USERINFO_URL", defaults["USERINFO_URL"]) or "",
        "scopes": _provider_env(provider, "SCOPES", defaults["SCOPES"]) or "",
    }


def _json_request(url: str, *, data: dict[str, str] | None = None, headers: dict[str, str] | None = None) -> dict:
    encoded = urlencode(data).encode() if data is not None else None
    request = UrlRequest(url, data=encoded, headers=headers or {}, method="POST" if data is not None else "GET")
    try:
        with urlopen(request, timeout=10) as response:  # nosec B310; URL is trusted configuration.
            return json.loads(response.read())
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
        raise AppError("The OAuth provider could not complete sign-in.", code="OAUTH_PROVIDER_ERROR", status_code=502) from error


async def exchange_profile(provider: str, code: str, verifier: str, config: dict[str, str]) -> OAuthProfile:
    token = await asyncio.to_thread(_json_request, config["token_url"], data={"grant_type": "authorization_code", "code": code, "client_id": config["client_id"], "client_secret": config["client_secret"], "redirect_uri": config["redirect_uri"], "code_verifier": verifier}, headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"})
    access_token = token.get("access_token")
    if not isinstance(access_token, str) or not access_token:
        raise AppError("The OAuth provider did not return an access token.", code="OAUTH_PROVIDER_ERROR", status_code=502)
    headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json", "User-Agent": "create-my-saas"}
    profile = await asyncio.to_thread(_json_request, config["userinfo_url"], headers=headers)
    if provider == "github" and not profile.get("email"):
        emails = await asyncio.to_thread(_json_request, "https://api.github.com/user/emails", headers=headers)
        profile["email"] = next((entry.get("email") for entry in emails if entry.get("primary") and entry.get("verified")), None)
    email = profile.get("email")
    verified = profile.get("email_verified", True) if provider == "google" else bool(email)
    if not isinstance(email, str) or not email or not verified:
        raise AppError("The OAuth provider did not provide a verified email address.", code="OAUTH_EMAIL_UNVERIFIED", status_code=400)
    provider_account_id = profile.get("sub") if provider == "google" else profile.get("id")
    if isinstance(provider_account_id, bool) or not isinstance(provider_account_id, (str, int)) or not str(provider_account_id):
        raise AppError("The OAuth provider did not return a stable account identifier.", code="OAUTH_PROVIDER_ERROR", status_code=502)
    return OAuthProfile(email=email.lower(), name=str(profile.get("name") or profile.get("login") or email.split("@", 1)[0])[:120], provider_account_id=str(provider_account_id))


@router.get("/{provider}/start")
async def oauth_start(provider: str, db: AsyncSession = Depends(get_db)):
    config = _provider_config(provider)
    if not config:
        raise AppError("This OAuth provider is not configured.", code="OAUTH_PROVIDER_UNAVAILABLE", status_code=404)
    verifier = token_urlsafe(64)
    challenge = urlsafe_b64encode(sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = token_urlsafe(24)
    db.add(OAuthState(provider=provider, state_hash=token_hash(state), code_verifier=verifier, expires_at=utc_now() + timedelta(minutes=10)))
    await db.commit()
    query = urlencode({"client_id": config["client_id"], "redirect_uri": config["redirect_uri"], "response_type": "code", "scope": config["scopes"], "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    return RedirectResponse(f"{config['authorization_url']}?{query}")


@router.get("/{provider}/callback")
async def oauth_callback(provider: str, code: str = Query(min_length=1), state: str = Query(min_length=1), db: AsyncSession = Depends(get_db), users: UserRepository = Depends(get_user_repository)):
    config = _provider_config(provider)
    if not config:
        raise AppError("This OAuth provider is not configured.", code="OAUTH_PROVIDER_UNAVAILABLE", status_code=404)
    verifier = (await db.execute(update(OAuthState).where(OAuthState.provider == provider, OAuthState.state_hash == token_hash(state), OAuthState.used_at.is_(None), OAuthState.expires_at > utc_now()).values(used_at=utc_now()).returning(OAuthState.code_verifier))).scalar_one_or_none()
    await db.commit()
    if not verifier:
        raise AppError("OAuth state is invalid or expired.", code="OAUTH_STATE_INVALID", status_code=400)
    profile = await exchange_profile(provider, code, verifier, config)
    _, refresh_token = await AuthService(db, users).login_oauth(provider, profile)
    response = RedirectResponse(f"{settings.frontend_url.rstrip('/')}/auth/oauth/callback", status_code=303)
    set_session_cookies(response, refresh_token)
    return response
