"""Concurrency and replay contracts that require PostgreSQL's real semantics.

They are deliberately opt-in so a contributor can run the regular unit suite
without a local database. CI sets POSTGRES_INTEGRATION_TESTS=1 after applying
the Alembic migrations.
"""
import asyncio
import os
import unittest
from base64 import urlsafe_b64encode
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlparse

from sqlalchemy import func, select, text

from src.core.config import settings
from src.core.config.settings import Settings
from src.core.exceptions import AppError
from src.db.base import Base
from src.db.database import SessionLocal, engine
from src.modules.auth import oauth
from src.modules.auth.security.tokens import token_hash
from src.modules.auth.service import AuthService
from src.modules.auth.security.password import verify_password
from src.modules.billing.service import BillingService
from src.modules.organizations import invitations, member_service, ownership_service
from src.modules.organizations.access import require_role
from src.modules.organizations.schemas import (
    AcceptInvite,
    InviteCreate,
    MembershipUpdate,
    OrganizationCreate,
    OwnershipTransfer,
)
from src.modules.organizations.service import create_organization
from src.modules.users import service as user_service
from src.modules.users.model import (
    BillingWebhookEvent,
    Invitation,
    Membership,
    MembershipRole,
    OAuthAccount,
    OAuthState,
    OneTimeToken,
    Subscription,
    TokenPurpose,
    User,
)
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

    async def _create_user(
        self,
        email: str,
        *,
        verified: bool = True,
        password_hash: str | None = "not-used",
    ) -> User:
        async with SessionLocal() as db:
            return await UserRepository(db).create_user(
                User(
                    email=email,
                    name=email.split("@", 1)[0].title(),
                    password_hash=password_hash,
                    email_verified=verified,
                )
            )

    async def _create_organization(self, owner: User, slug: str):
        async with SessionLocal() as db:
            return await create_organization(
                OrganizationCreate(name=f"{slug} organization", slug=slug),
                owner,
                db,
            )

    async def _add_member(self, organization_id, user: User, role: MembershipRole) -> Membership:
        async with SessionLocal() as db:
            membership = Membership(
                organization_id=organization_id,
                user_id=user.id,
                role=role.value,
            )
            db.add(membership)
            await db.commit()
            await db.refresh(membership)
            return membership

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

    async def test_reset_and_verification_tokens_are_single_use_and_revoke_sessions(self):
        user = await self._create_user("recover@example.com", verified=False, password_hash="not-used")
        async with SessionLocal() as db:
            users = UserRepository(db)
            auth = AuthService(db, users)
            _, refresh_token = await auth.issue_session(user)
            superseded = await auth.create_one_time_token(user, TokenPurpose.PASSWORD_RESET)
            reset_token = await auth.create_one_time_token(user, TokenPurpose.PASSWORD_RESET)
            self.assertIsNone(await auth.consume_one_time_token(superseded, TokenPurpose.PASSWORD_RESET))

        async with SessionLocal() as db:
            await user_service.confirm_password_reset(
                SimpleNamespace(token=reset_token, new_password="new-password2"),
                db,
                UserRepository(db),
            )
            stored = await UserRepository(db).get_user_by_id(user.id)
            self.assertTrue(verify_password("new-password2", stored.password_hash or ""))
            self.assertIsNone(
                await AuthService(db, UserRepository(db)).consume_one_time_token(
                    reset_token, TokenPurpose.PASSWORD_RESET
                )
            )

        self.assertIsNone(await self._refresh(refresh_token))

        async with SessionLocal() as db:
            verification_token = await AuthService(db, UserRepository(db)).create_one_time_token(
                user, TokenPurpose.EMAIL_VERIFICATION
            )
        async with SessionLocal() as db:
            verified_user = await user_service.confirm_verification(
                SimpleNamespace(token=verification_token), db, UserRepository(db)
            )
            self.assertTrue(verified_user.email_verified)
            with self.assertRaises(AppError) as replay:
                await user_service.confirm_verification(
                    SimpleNamespace(token=verification_token), db, UserRepository(db)
                )
            self.assertEqual(replay.exception.code, "INVALID_VERIFICATION_TOKEN")

        async with SessionLocal() as db:
            token_count = await db.scalar(select(func.count()).select_from(OneTimeToken))
            self.assertEqual(token_count, 3)

    async def test_invitations_enforce_recipient_binding_and_idempotent_acceptance(self):
        owner = await self._create_user("owner@example.com")
        invited = await self._create_user("invited@example.com")
        stranger = await self._create_user("stranger@example.com")
        organization = await self._create_organization(owner, "invite-security")
        delivered: list[str] = []

        with patch.object(
            invitations,
            "send_secure_email",
            new=AsyncMock(side_effect=lambda **message: delivered.append(message["body"])),
        ):
            async with SessionLocal() as db:
                result = await invitations.invite(
                    organization.id,
                    InviteCreate(email=invited.email, role=MembershipRole.BILLING),
                    owner,
                    db,
                )
        self.assertFalse(result["accepted"])
        self.assertEqual(len(delivered), 1)
        raw_token = delivered[0].rsplit(": ", 1)[1]

        async with SessionLocal() as db:
            await invitations.accept_invitation(AcceptInvite(token=raw_token), invited, db)
        async with SessionLocal() as db:
            # A retry by the intended recipient has no side effects.
            await invitations.accept_invitation(AcceptInvite(token=raw_token), invited, db)
            membership = (
                await db.execute(
                    select(Membership).where(
                        Membership.organization_id == organization.id,
                        Membership.user_id == invited.id,
                    )
                )
            ).scalar_one()
            self.assertEqual(membership.role, MembershipRole.BILLING.value)
            with self.assertRaises(AppError) as foreign_acceptance:
                await invitations.accept_invitation(AcceptInvite(token=raw_token), stranger, db)
            self.assertEqual(foreign_acceptance.exception.code, "INVALID_INVITATION")
            invitation = (await db.execute(select(Invitation))).scalar_one()
            self.assertIsNotNone(invitation.accepted_at)

    async def test_rbac_and_ownership_guards_persist_their_role_boundaries(self):
        owner = await self._create_user("owner@example.com")
        admin = await self._create_user("admin@example.com")
        billing = await self._create_user("billing@example.com")
        member = await self._create_user("member@example.com")
        outsider = await self._create_user("outsider@example.com")
        organization = await self._create_organization(owner, "rbac-security")
        admin_membership = await self._add_member(organization.id, admin, MembershipRole.ADMIN)
        await self._add_member(organization.id, billing, MembershipRole.BILLING)
        await self._add_member(organization.id, member, MembershipRole.MEMBER)

        async with SessionLocal() as db:
            for permitted in (owner, admin, billing):
                await require_role(
                    organization.id,
                    permitted,
                    db,
                    {MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.BILLING},
                )
            for forbidden, code in ((member, "INSUFFICIENT_ROLE"), (outsider, "MEMBERSHIP_REQUIRED")):
                with self.assertRaises(AppError) as denied:
                    await require_role(
                        organization.id,
                        forbidden,
                        db,
                        {MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.BILLING},
                    )
                self.assertEqual(denied.exception.code, code)

        async with SessionLocal() as db:
            await ownership_service.transfer_ownership(
                organization.id, OwnershipTransfer(user_id=admin.id), owner, db
            )
        async with SessionLocal() as db:
            memberships = {
                membership.user_id: membership.role
                for membership in (
                    await db.execute(
                        select(Membership).where(Membership.organization_id == organization.id)
                    )
                ).scalars()
            }
            self.assertEqual(memberships[admin.id], MembershipRole.OWNER.value)
            self.assertEqual(memberships[owner.id], MembershipRole.ADMIN.value)
            with self.assertRaises(AppError) as owner_removal:
                await member_service.remove_member(organization.id, admin_membership.id, owner, db)
            self.assertEqual(owner_removal.exception.code, "OWNER_REQUIRED")
            with self.assertRaises(AppError) as owner_role_change:
                await member_service.update_member_role(
                    organization.id,
                    admin_membership.id,
                    MembershipUpdate(role=MembershipRole.MEMBER),
                    owner,
                    db,
                )
            self.assertEqual(owner_role_change.exception.code, "OWNER_ROLE_PROTECTED")

    async def test_verified_webhooks_are_deduplicated_and_cannot_rebind_customers(self):
        owner = await self._create_user("billing-owner@example.com")
        other_owner = await self._create_user("other-owner@example.com")
        organization = await self._create_organization(owner, "billing-security")
        other_organization = await self._create_organization(other_owner, "billing-other")
        config = replace(
            settings,
            stripe_secret_key="sk_test",
            stripe_webhook_secret="whsec_test",
            stripe_price_plans='{"price_pro":{"name":"pro","entitlements":{"api_calls":100}}}',
        )
        completed = SimpleNamespace(
            id="evt_checkout_1",
            type="checkout.session.completed",
            data=SimpleNamespace(
                object=SimpleNamespace(
                    metadata={"organization_id": str(organization.id)},
                    client_reference_id=str(organization.id),
                    customer="cus_security",
                )
            ),
        )
        with patch("src.modules.billing.service.stripe.Webhook.construct_event", return_value=completed):
            async with SessionLocal() as db:
                result = await BillingService(db, config).handle_webhook(b"signed", "signature")
                self.assertEqual(result, {"accepted": True, "duplicate": False})
            async with SessionLocal() as db:
                duplicate = await BillingService(db, config).handle_webhook(b"signed", "signature")
                self.assertEqual(duplicate, {"accepted": True, "duplicate": True})
                subscription = (
                    await db.execute(
                        select(Subscription).where(Subscription.organization_id == organization.id)
                    )
                ).scalar_one()
                self.assertEqual(subscription.provider_customer_id, "cus_security")
                self.assertEqual(
                    await db.scalar(select(func.count()).select_from(BillingWebhookEvent)), 1
                )

        async with SessionLocal() as db:
            db.add(
                Subscription(
                    organization_id=other_organization.id,
                    provider="stripe",
                    provider_customer_id="cus_other",
                )
            )
            await db.commit()
        mismatch = SimpleNamespace(
            id="evt_checkout_mismatch",
            type="checkout.session.completed",
            data=SimpleNamespace(
                object=SimpleNamespace(
                    metadata={"organization_id": str(other_organization.id)},
                    client_reference_id=str(other_organization.id),
                    customer="cus_different",
                )
            ),
        )
        with patch("src.modules.billing.service.stripe.Webhook.construct_event", return_value=mismatch):
            async with SessionLocal() as db:
                with self.assertRaises(AppError) as rejected:
                    await BillingService(db, config).handle_webhook(b"signed", "signature")
                self.assertEqual(rejected.exception.code, "BILLING_CUSTOMER_MISMATCH")
                self.assertIsNone(
                    await db.scalar(
                        select(BillingWebhookEvent.id).where(
                            BillingWebhookEvent.provider_event_id == "evt_checkout_mismatch"
                        )
                    )
                )

    async def test_github_callback_rejects_expired_state_and_links_the_verified_account(self):
        enabled_settings = Settings(**{**oauth.settings.__dict__, "oauth_enabled": True})
        environment = {
            "OAUTH_GITHUB_CLIENT_ID": "postgres-integration-client",
            "OAUTH_GITHUB_CLIENT_SECRET": "postgres-integration-secret",
            "OAUTH_GITHUB_AUTHORIZATION_URL": "https://github.test/authorize",
            "OAUTH_GITHUB_TOKEN_URL": "https://github.test/token",
            "OAUTH_GITHUB_USERINFO_URL": "https://github.test/user",
            "OAUTH_GITHUB_REDIRECT_URI": "https://api.test/auth/oauth/github/callback",
        }
        calls: list[str] = []

        def provider_response(url: str, *, data=None, headers=None):
            calls.append(url)
            if url == "https://github.test/token":
                self.assertIsNotNone(data)
                self.assertGreaterEqual(len(data["code_verifier"]), 86)
                return {"access_token": "github-access"}
            if url == "https://github.test/user":
                return {"id": 42, "login": "octocat"}
            if url == "https://api.github.com/user/emails":
                return [{"email": "octocat@example.com", "primary": True, "verified": True}]
            raise AssertionError(f"unexpected OAuth URL: {url}")

        with patch.dict(os.environ, environment), patch.object(
            oauth, "settings", enabled_settings
        ), patch.object(oauth, "_json_request", side_effect=provider_response):
            async with SessionLocal() as db:
                start = await oauth.oauth_start("github", db)
            state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
            async with SessionLocal() as db:
                response = await oauth.oauth_callback(
                    "github", "code-1", state, db, UserRepository(db)
                )
                self.assertEqual(response.status_code, 303)
            async with SessionLocal() as db:
                account = (await db.execute(select(OAuthAccount))).scalar_one()
                user = await UserRepository(db).get_user_by_id(account.user_id)
                self.assertEqual((account.provider, account.provider_account_id), ("github", "42"))
                self.assertEqual(user.email, "octocat@example.com")
                self.assertTrue(user.email_verified)

            expired_state = "expired-github-state"
            async with SessionLocal() as db:
                db.add(
                    OAuthState(
                        provider="github",
                        state_hash=token_hash(expired_state),
                        code_verifier="v" * 86,
                        expires_at=oauth.utc_now() - timedelta(seconds=1),
                    )
                )
                await db.commit()
            async with SessionLocal() as db:
                with self.assertRaises(AppError) as expired:
                    await oauth.oauth_callback(
                        "github", "code-expired", expired_state, db, UserRepository(db)
                    )
                self.assertEqual(expired.exception.code, "OAUTH_STATE_INVALID")
        self.assertEqual(
            calls,
            [
                "https://github.test/token",
                "https://github.test/user",
                "https://api.github.com/user/emails",
            ],
        )

    async def test_concurrent_first_oauth_linking_resolves_to_one_user_and_account(self):
        profile = SimpleNamespace(
            email="first-link@example.com",
            name="First Link",
            provider_account_id="github-100",
        )
        barrier = asyncio.Barrier(2)
        original_get_by_email = UserRepository.get_user_by_email
        calls = 0

        async def synchronized_get_by_email(repository, email):
            nonlocal calls
            if calls < 2:
                calls += 1
                await barrier.wait()
            return await original_get_by_email(repository, email)

        async def login_once():
            async with SessionLocal() as db:
                return await AuthService(db, UserRepository(db)).login_oauth("github", profile)

        with patch.object(UserRepository, "get_user_by_email", synchronized_get_by_email):
            outcomes = await asyncio.gather(login_once(), login_once())
        self.assertEqual(len(outcomes), 2)
        self.assertTrue(all(refresh for _, refresh in outcomes))
        async with SessionLocal() as db:
            self.assertEqual(await db.scalar(select(func.count()).select_from(User)), 1)
            self.assertEqual(await db.scalar(select(func.count()).select_from(OAuthAccount)), 1)
