from datetime import timedelta
from urllib.parse import urlencode

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import settings
from src.core.email import send_secure_email
from src.core.exceptions import AppError
from src.modules.auth.security.password import hash_password, verify_password
from src.modules.auth.security.tokens import (
    encode_access_token,
    opaque_token,
    token_hash,
    utc_now,
)
from src.modules.users.model import (
    OAuthAccount,
    OneTimeToken,
    RefreshToken,
    TokenPurpose,
    User,
)
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import UserLogin, UserPublic, UserRegister


class AuthService:
    def __init__(self, db: AsyncSession, users: UserRepository):
        self.db = db
        self.users = users

    async def register(self, payload: UserRegister) -> User | None:
        email = str(payload.email).lower()
        if await self.users.get_user_by_email(email):
            return None

        return await self.users.create_user(
            User(
                email=email,
                name=payload.name,
                password_hash=hash_password(payload.password),
            )
        )

    async def login(self, payload: UserLogin) -> tuple[User, tuple[dict, str]] | None:
        user = await self.users.get_user_by_email(str(payload.email))
        if (
            not user
            or not user.is_active
            or not user.password_hash
            or not verify_password(payload.password, user.password_hash)
        ):
            return None

        return user, await self.issue_session(user)

    async def login_oauth(self, provider: str, profile) -> tuple[dict, str]:
        """Resolve a stable provider subject before using email to bootstrap its link."""
        account = await self._get_oauth_account(
            provider,
            profile.provider_account_id,
        )
        email_user = await self.users.get_user_by_email(profile.email)

        if account:
            if email_user and email_user.id != account.user_id:
                self._raise_oauth_account_conflict()

            user = await self.users.get_user_by_id(account.user_id)
            if not user:
                self._raise_oauth_account_conflict()

            return await self._complete_oauth_session(user)

        user = email_user or await self._create_oauth_user(profile)
        await self._link_oauth_account(provider, profile.provider_account_id, user)
        return await self._complete_oauth_session(user)

    async def _get_oauth_account(
        self,
        provider: str,
        provider_account_id: str,
    ) -> OAuthAccount | None:
        result = await self.db.execute(
            select(OAuthAccount).where(
                OAuthAccount.provider == provider,
                OAuthAccount.provider_account_id == provider_account_id,
            )
        )
        return result.scalar_one_or_none()

    async def _create_oauth_user(self, profile) -> User:
        try:
            return await self.users.create_user(
                User(
                    email=profile.email,
                    name=profile.name,
                    password_hash=None,
                    email_verified=True,
                )
            )
        except IntegrityError:
            # Two first-time callbacks for the same verified address can both
            # observe no local user. The email unique constraint is the arbiter.
            await self.db.rollback()
            user = await self.users.get_user_by_email(profile.email)
            if not user:
                raise
            return user

    async def _link_oauth_account(
        self,
        provider: str,
        provider_account_id: str,
        user: User,
    ) -> None:
        self.db.add(
            OAuthAccount(
                user_id=user.id,
                provider=provider,
                provider_account_id=provider_account_id,
            )
        )
        try:
            await self.db.commit()
        except IntegrityError:
            await self.db.rollback()
            account = await self._get_oauth_account(provider, provider_account_id)
            if not account or account.user_id != user.id:
                self._raise_oauth_account_conflict()

    @staticmethod
    def _raise_oauth_account_conflict() -> None:
        raise AppError(
            "This OAuth account is linked to a different user.",
            code="OAUTH_ACCOUNT_CONFLICT",
            status_code=409,
        )

    async def _complete_oauth_session(self, user: User) -> tuple[dict, str]:
        if not user.is_active:
            raise AppError(
                "The user account is inactive.",
                code="USER_INACTIVE",
                status_code=403,
            )
        if not user.email_verified:
            user.email_verified = True
            await self.users.save(user)
        return await self.issue_session(user)

    def _new_session(self, user: User) -> tuple[str, RefreshToken]:
        raw_token = opaque_token()
        refresh_token = RefreshToken(
            user_id=user.id,
            jti=opaque_token()[:48],
            token_hash=token_hash(raw_token),
            expires_at=utc_now() + timedelta(days=settings.refresh_token_expire_days),
        )
        return raw_token, refresh_token

    def _session_response(self, user: User) -> dict:
        access_token = encode_access_token(user.id)
        # Keep the legacy snake_case field during the starter transition, while
        # exposing the browser contract consumed by every frontend template.
        return {
            "accessToken": access_token,
            "access_token": access_token,
            "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60,
            "user": UserPublic.model_validate(user).model_dump(mode="json"),
        }

    async def issue_session(self, user: User) -> tuple[dict, str]:
        raw_token, refresh_token = self._new_session(user)
        self.db.add(refresh_token)
        await self.db.commit()
        return self._session_response(user), raw_token

    async def refresh(self, raw_token: str) -> tuple[dict, str] | None:
        # The conditional update is the single-use claim. Only its winner issues
        # a new token.
        now = utc_now()
        token_digest = token_hash(raw_token)
        result = await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_digest,
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .values(revoked_at=now)
            .returning(RefreshToken.user_id)
        )
        claimed_user_id = result.scalar_one_or_none()
        if not claimed_user_id:
            await self._handle_unclaimable_refresh_token(token_digest, now)
            return None

        user = await self.users.get_user_by_id(claimed_user_id)
        if not user or not user.is_active:
            await self.db.commit()
            return None

        next_raw_token, next_refresh_token = self._new_session(user)
        self.db.add(next_refresh_token)
        await self.db.commit()
        return self._session_response(user), next_raw_token

    async def _handle_unclaimable_refresh_token(self, token_digest: str, now) -> None:
        result = await self.db.execute(
            select(RefreshToken).where(RefreshToken.token_hash == token_digest)
        )
        token = result.scalar_one_or_none()
        if not token:
            return

        # A known token that cannot be claimed is a replay or expired credential.
        # Revoke every active session belonging to that user.
        await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == token.user_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=now)
        )
        await self.db.commit()

    async def revoke(self, raw_token: str) -> None:
        result = await self.db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash(raw_token)
            )
        )
        token = result.scalar_one_or_none()
        if token and not token.revoked_at:
            token.revoked_at = utc_now()
            await self.db.commit()

    async def revoke_all(self, user_id) -> None:
        await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.user_id == user_id,
                RefreshToken.revoked_at.is_(None),
            )
            .values(revoked_at=utc_now())
        )
        await self.db.commit()

    async def create_one_time_token(self, user: User, purpose: TokenPurpose) -> str:
        # A new link supersedes any earlier, unconsumed link for the same action.
        now = utc_now()
        await self.db.execute(
            update(OneTimeToken)
            .where(
                OneTimeToken.user_id == user.id,
                OneTimeToken.purpose == purpose.value,
                OneTimeToken.consumed_at.is_(None),
            )
            .values(consumed_at=now)
        )
        raw_token = opaque_token()
        expires_in = 24 if purpose == TokenPurpose.EMAIL_VERIFICATION else 1
        self.db.add(
            OneTimeToken(
                user_id=user.id,
                purpose=purpose.value,
                token_hash=token_hash(raw_token),
                expires_at=now + timedelta(hours=expires_in),
            )
        )
        await self.db.commit()
        return raw_token

    async def send_one_time_token(self, user: User, purpose: TokenPurpose) -> None:
        raw_token = await self.create_one_time_token(user, purpose)
        if purpose == TokenPurpose.PASSWORD_RESET:
            path = "/reset-password"
            subject = "Reset your password"
        else:
            path = "/verify-email"
            subject = "Verify your email"

        await send_secure_email(
            recipient=user.email,
            subject=subject,
            body=(
                "Use this one-time link: "
                f"{settings.frontend_url.rstrip('/')}{path}?"
                f"{urlencode({'token': raw_token})}"
            ),
        )

    async def consume_one_time_token(
        self,
        raw_token: str,
        purpose: TokenPurpose,
    ) -> User | None:
        now = utc_now()
        result = await self.db.execute(
            update(OneTimeToken)
            .where(
                OneTimeToken.token_hash == token_hash(raw_token),
                OneTimeToken.purpose == purpose.value,
                OneTimeToken.consumed_at.is_(None),
                OneTimeToken.expires_at > now,
            )
            .values(consumed_at=now)
            .returning(OneTimeToken.user_id)
        )
        user_id = result.scalar_one_or_none()
        if not user_id:
            return None

        user = await self.users.get_user_by_id(user_id)
        await self.db.commit()
        return user
