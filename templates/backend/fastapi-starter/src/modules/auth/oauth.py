"""Provider-neutral OAuth authorization-code entry point with PKCE.

An integration supplies OAUTH_<PROVIDER>_AUTHORIZATION_URL, CLIENT_ID and scopes.
The exchange/profile mapping belongs in a deployment-specific adapter, keeping provider
credentials and provider SDKs out of the starter itself.
"""
from datetime import timedelta
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.config import settings
from src.db.database import get_db
from src.modules.auth.security.tokens import token_hash, utc_now
from src.modules.users.model import OAuthState

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])

def _provider_env(provider: str, name: str) -> str | None:
    if not provider.replace("-", "").replace("_", "").isalnum(): return None
    return os.getenv(f"OAUTH_{provider.upper().replace('-', '_')}_{name}")

@router.get("/{provider}/start")
async def oauth_start(provider: str, db: AsyncSession = Depends(get_db)):
    authorization_url = _provider_env(provider, "AUTHORIZATION_URL")
    client_id = _provider_env(provider, "CLIENT_ID")
    if not settings.oauth_enabled or not authorization_url or not client_id:
        raise HTTPException(404, "OAuth provider is not configured")
    verifier = token_urlsafe(64)
    challenge = urlsafe_b64encode(sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = token_urlsafe(24)
    callback = f"{settings.oauth_callback_base_url.rstrip('/')}/auth/oauth/{provider}/callback"
    db.add(OAuthState(provider=provider, state_hash=token_hash(state), code_verifier=verifier, expires_at=utc_now() + timedelta(minutes=10)))
    await db.commit()
    query = urlencode({"client_id": client_id, "redirect_uri": callback, "response_type": "code", "scope": _provider_env(provider, "SCOPES") or "openid email profile", "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    return RedirectResponse(f"{authorization_url}?{query}")

@router.get("/{provider}/callback")
async def oauth_callback(provider: str, code: str = Query(min_length=1), state: str = Query(min_length=1), db: AsyncSession = Depends(get_db)):
    verifier = (await db.execute(
        update(OAuthState)
        .where(OAuthState.provider == provider, OAuthState.state_hash == token_hash(state), OAuthState.used_at.is_(None), OAuthState.expires_at > utc_now())
        .values(used_at=utc_now())
        .returning(OAuthState.code_verifier)
    )).scalar_one_or_none()
    await db.commit()
    if not verifier:
        raise HTTPException(400, "OAuth state does not match the provider")
    # Deliberately no token exchange here: implement OAuthProviderAdapter in the product
    # and use the server-side verifier when exchanging `code`; this preserves PKCE validation.
    raise HTTPException(501, "OAuth provider adapter is not installed")
