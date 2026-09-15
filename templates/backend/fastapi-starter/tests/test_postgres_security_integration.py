"""Concurrency and replay contracts that require PostgreSQL's real semantics.

They are deliberately opt-in so a contributor can run the regular unit suite
without a local database. CI sets POSTGRES_INTEGRATION_TESTS=1 after applying
the Alembic migrations.
"""
import asyncio
import os
import unittest
from base64 import urlsafe_b64encode
from hashlib import sha256
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select, text

from src.core.config.settings import Settings
from src.core.exceptions import AppError
from src.db.base import Base
from src.db.database import SessionLocal, engine
from src.modules.auth import oauth
from src.modules.auth.security.tokens import token_hash
from src.modules.auth.service import AuthService
from src.modules.users.model import OAuthState, User
from src.modules.users.repository import UserRepository


@unittest.skipUnless(
    os.getenv("POSTGRES_INTEGRATION_TESTS") == "1",
    "set POSTGRES_INTEGRATION_TESTS=1 to run PostgreSQL integration contracts",
)
class PostgresSecurityIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.assertEqual(engine.dialect.name, "postgresql")
        await self._reset_database()

    async def asyncTearDown(self):
        await self._reset_database()
        # IsolatedAsyncioTestCase creates a loop per test. Dispose pooled
        # asyncpg connections so the next test never reuses another loop's
        # transport.
        await engine.dispose()

    async def _reset_database(self):
        # Table names originate in ORM metadata, not test input. CASCADE keeps
        # cleanup correct as security tables gain foreign-key relationships.
        names = ", ".join(table.name for table in reversed(Base.metadata.sorted_tables))
        async with SessionLocal() as db:
            await db.execute(text(f"TRUNCATE TABLE {names} RESTART IDENTITY CASCADE"))
            await db.commit()

    async def _create_session(self) -> tuple[dict, str]:
        async with SessionLocal() as db:
            users = UserRepository(db)
            user = await users.create_user(
                User(email="race@example.com", name="Race", password_hash="not-used", email_verified=True)
            )
            return await AuthService(db, users).issue_session(user)

    async def _refresh(self, raw_token: str):
        async with SessionLocal() as db:
            return await AuthService(db, UserRepository(db)).refresh(raw_token)

    async def test_refresh_claim_is_atomic_and_replay_revokes_the_rotated_session(self):
        _, refresh_token = await self._create_session()

        outcomes = await asyncio.gather(
            self._refresh(refresh_token),
            self._refresh(refresh_token),
        )
        successful = [outcome for outcome in outcomes if outcome is not None]
        self.assertEqual(len(successful), 1)

        # The loser observed a known-but-already-claimed token and revoked the
        # active replacement. This verifies replay behaviour across two real
        # asyncpg connections, rather than an in-memory session double.
        _, replacement = successful[0]
        self.assertIsNone(await self._refresh(replacement))

    async def test_oauth_state_uses_real_postgres_claiming_and_s256_pkce(self):
        enabled_settings = Settings(**{**oauth.settings.__dict__, "oauth_enabled": True})
        provider_calls: list[tuple[str, dict[str, str] | None]] = []

        def provider_response(url: str, *, data=None, headers=None):
            provider_calls.append((url, data))
            if url == "https://oauth.test/token":
                self.assertIsNotNone(data)
                self.assertIn("code_verifier", data)
                return {"access_token": "provider-access-token"}
            if url == "https://oauth.test/userinfo":
                return {"sub": "google-subject-1", "email": "oauth@example.com", "email_verified": True, "name": "OAuth User"}
            raise AssertionError(f"unexpected OAuth URL: {url}")

        environment = {
            "OAUTH_GOOGLE_CLIENT_ID": "postgres-integration-client",
            "OAUTH_GOOGLE_CLIENT_SECRET": "postgres-integration-secret",
            "OAUTH_GOOGLE_AUTHORIZATION_URL": "https://oauth.test/authorize",
            "OAUTH_GOOGLE_TOKEN_URL": "https://oauth.test/token",
            "OAUTH_GOOGLE_USERINFO_URL": "https://oauth.test/userinfo",
            "OAUTH_GOOGLE_REDIRECT_URI": "https://api.test/auth/oauth/google/callback",
        }
        with patch.dict(os.environ, environment), patch.object(oauth, "settings", enabled_settings), patch.object(
            oauth, "_json_request", side_effect=provider_response
        ):
            async with SessionLocal() as db:
                start = await oauth.oauth_start("google", db)
            query = parse_qs(urlparse(start.headers["location"]).query)
            state = query["state"][0]
            challenge = query["code_challenge"][0]
            self.assertEqual(query["code_challenge_method"], ["S256"])

            async def callback():
                async with SessionLocal() as db:
                    return await oauth.oauth_callback("google", "code-1", state, db, UserRepository(db))

            outcomes = await asyncio.gather(callback(), callback(), return_exceptions=True)

        successes = [outcome for outcome in outcomes if not isinstance(outcome, Exception)]
        failures = [outcome for outcome in outcomes if isinstance(outcome, Exception)]
        self.assertEqual(len(successes), 1)
        self.assertEqual(successes[0].status_code, 303)
        self.assertEqual(len(failures), 1)
        self.assertIsInstance(failures[0], AppError)
        self.assertEqual(failures[0].code, "OAUTH_STATE_INVALID")
        self.assertEqual([url for url, _ in provider_calls], ["https://oauth.test/token", "https://oauth.test/userinfo"])

        async with SessionLocal() as db:
            record = (await db.execute(select(OAuthState).where(OAuthState.state_hash == token_hash(state)))).scalar_one()
        self.assertIsNotNone(record.used_at)
        self.assertEqual(
            urlsafe_b64encode(sha256(record.code_verifier.encode()).digest()).rstrip(b"=").decode(),
            challenge,
        )
