from datetime import timedelta
from urllib.parse import urlencode
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.config import settings
from src.core.email import send_secure_email
from src.modules.users.repository import UserRepository
from src.modules.users.schemas import UserLogin, UserRegister
from src.modules.users.model import RefreshToken, OneTimeToken, TokenPurpose, User
from src.modules.auth.security.password import hash_password, verify_password
from src.modules.auth.security.tokens import encode_access_token, opaque_token, token_hash, utc_now

class AuthService:
    def __init__(self, db: AsyncSession, users: UserRepository): self.db, self.users = db, users

    async def register(self, payload: UserRegister) -> User | None:
        if await self.users.get_user_by_email(str(payload.email)): return None
        return await self.users.create_user(User(email=str(payload.email).lower(), name=payload.name, password_hash=hash_password(payload.password)))

    async def login(self, payload: UserLogin) -> tuple[User, dict] | None:
        user = await self.users.get_user_by_email(str(payload.email))
        if not user or not user.is_active or not user.password_hash or not verify_password(payload.password, user.password_hash): return None
        return user, await self.issue_session(user)

    def _new_session(self, user: User) -> tuple[str, RefreshToken]:
        raw = opaque_token()
        return raw, RefreshToken(user_id=user.id, jti=opaque_token()[:48], token_hash=token_hash(raw), expires_at=utc_now() + timedelta(days=settings.refresh_token_expire_days))

    def _session_response(self, user: User, raw: str) -> dict:
        return {"access_token": encode_access_token(user.id), "refresh_token": raw, "token_type": "bearer", "expires_in": settings.access_token_expire_minutes * 60}

    async def issue_session(self, user: User) -> dict:
        raw, record = self._new_session(user)
        self.db.add(record); await self.db.commit()
        return self._session_response(user, raw)

    async def refresh(self, raw: str) -> dict | None:
        # The conditional update is the single-use claim. Only its winner issues a new token.
        now = utc_now()
        claimed_user_id = (await self.db.execute(
            update(RefreshToken)
            .where(
                RefreshToken.token_hash == token_hash(raw),
                RefreshToken.revoked_at.is_(None),
                RefreshToken.expires_at > now,
            )
            .values(revoked_at=now)
            .returning(RefreshToken.user_id)
        )).scalar_one_or_none()
        if not claimed_user_id:
            known = (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))).scalar_one_or_none()
            # A known token that cannot be claimed is a replay/expired credential: revoke all sessions.
            if known:
                await self.db.execute(update(RefreshToken).where(RefreshToken.user_id == known.user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=now))
                await self.db.commit()
            return None
        user = await self.users.get_user_by_id(claimed_user_id)
        if not user or not user.is_active:
            await self.db.commit()
            return None
        next_raw, next_record = self._new_session(user)
        self.db.add(next_record)
        await self.db.commit()
        return self._session_response(user, next_raw)

    async def revoke(self, raw: str) -> None:
        token = (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))).scalar_one_or_none()
        if token and not token.revoked_at: token.revoked_at = utc_now(); await self.db.commit()

    async def revoke_all(self, user_id) -> None:
        await self.db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=utc_now())); await self.db.commit()

    async def create_one_time_token(self, user: User, purpose: TokenPurpose) -> str:
        # A new link supersedes any earlier, unconsumed link for the same action.
        # This keeps the inbox from containing multiple simultaneously valid reset
        # credentials while preserving an atomic, one-use claim at consumption time.
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
        raw = opaque_token(); self.db.add(OneTimeToken(user_id=user.id, purpose=purpose.value, token_hash=token_hash(raw), expires_at=now + timedelta(hours=24 if purpose == TokenPurpose.EMAIL_VERIFICATION else 1)))
        await self.db.commit(); return raw

    async def send_one_time_token(self, user: User, purpose: TokenPurpose) -> None:
        raw = await self.create_one_time_token(user, purpose)
        if purpose == TokenPurpose.PASSWORD_RESET:
            path, subject = "/reset-password", "Reset your password"
        else:
            path, subject = "/verify-email", "Verify your email"
        await send_secure_email(
            recipient=user.email,
            subject=subject,
            body=f"Use this one-time link: {settings.frontend_url.rstrip('/')}{path}?{urlencode({'token': raw})}",
        )

    async def consume_one_time_token(self, raw: str, purpose: TokenPurpose) -> User | None:
        now = utc_now()
        user_id = (await self.db.execute(
            update(OneTimeToken)
            .where(OneTimeToken.token_hash == token_hash(raw), OneTimeToken.purpose == purpose.value, OneTimeToken.consumed_at.is_(None), OneTimeToken.expires_at > now)
            .values(consumed_at=now)
            .returning(OneTimeToken.user_id)
        )).scalar_one_or_none()
        if not user_id: return None
        user = await self.users.get_user_by_id(user_id)
        await self.db.commit(); return user
