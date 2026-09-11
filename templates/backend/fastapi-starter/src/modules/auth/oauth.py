"""Provider-neutral OAuth authorization-code entry point with PKCE.

An integration supplies OAUTH_<PROVIDER>_AUTHORIZATION_URL, CLIENT_ID and scopes.
The exchange/profile mapping belongs in a deployment-specific adapter, keeping provider
credentials and provider SDKs out of the starter itself.
"""
from base64 import urlsafe_b64encode
from hashlib import sha256
from secrets import token_urlsafe
from urllib.parse import urlencode
import os
import jwt
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from src.core.config import settings

router = APIRouter(prefix="/auth/oauth", tags=["oauth"])

def _provider_env(provider: str, name: str) -> str | None:
    if not provider.replace("-", "").replace("_", "").isalnum(): return None
    return os.getenv(f"OAUTH_{provider.upper().replace('-', '_')}_{name}")

@router.get("/{provider}/start")
async def oauth_start(provider: str):
    authorization_url = _provider_env(provider, "AUTHORIZATION_URL")
    client_id = _provider_env(provider, "CLIENT_ID")
    if not settings.oauth_enabled or not authorization_url or not client_id:
        raise HTTPException(404, "OAuth provider is not configured")
    verifier = token_urlsafe(64)
    challenge = urlsafe_b64encode(sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    state = token_urlsafe(24)
    callback = f"{settings.oauth_callback_base_url.rstrip('/')}/auth/oauth/{provider}/callback"
    signed_state = jwt.encode({"provider": provider, "state": state, "verifier": verifier, "exp": __import__('time').time() + 600}, settings.secret_key, algorithm=settings.jwt_algorithm)
    query = urlencode({"client_id": client_id, "redirect_uri": callback, "response_type": "code", "scope": _provider_env(provider, "SCOPES") or "openid email profile", "state": signed_state, "code_challenge": challenge, "code_challenge_method": "S256"})
    return RedirectResponse(f"{authorization_url}?{query}")

@router.get("/{provider}/callback")
async def oauth_callback(provider: str, code: str = Query(min_length=1), state: str = Query(min_length=1)):
    try:
        payload = jwt.decode(state, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(400, "OAuth state is invalid or expired") from exc
    if payload.get("provider") != provider or not payload.get("verifier"):
        raise HTTPException(400, "OAuth state does not match the provider")
    # Deliberately no token exchange here: implement OAuthProviderAdapter in the product
    # and use payload["verifier"] when exchanging `code`; this preserves PKCE validation.
    raise HTTPException(501, "OAuth provider adapter is not installed")
