from datetime import timedelta
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from modules.users.repository import UserRepository
from modules.users.schemas import UserLogin, UserRegister
from modules.users.model import RefreshToken, OneTimeToken, TokenPurpose, User
from modules.auth.security.password import hash_password, verify_password
from modules.auth.security.tokens import encode_access_token, opaque_token, token_hash, utc_now
from core.config import settings

class AuthService:
    def __init__(self, db: AsyncSession, users: UserRepository): self.db, self.users = db, users

    async def register(self, payload: UserRegister) -> User | None:
        if await self.users.get_user_by_email(str(payload.email)): return None
        return await self.users.create_user(User(email=str(payload.email).lower(), name=payload.name, password_hash=hash_password(payload.password)))

    async def login(self, payload: UserLogin) -> tuple[User, dict] | None:
        user = await self.users.get_user_by_email(str(payload.email))
        if not user or not user.is_active or not user.password_hash or not verify_password(payload.password, user.password_hash): return None
        return user, await self.issue_session(user)

    async def issue_session(self, user: User) -> dict:
        raw = opaque_token(); record = RefreshToken(user_id=user.id, jti=opaque_token()[:48], token_hash=token_hash(raw), expires_at=utc_now() + timedelta(days=settings.refresh_token_expire_days))
        self.db.add(record); await self.db.commit()
        return {"access_token": encode_access_token(user.id), "refresh_token": raw, "token_type": "bearer", "expires_in": settings.access_token_expire_minutes * 60}

    async def refresh(self, raw: str) -> dict | None:
        token = (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))).scalar_one_or_none()
        if not token or token.revoked_at or token.expires_at <= utc_now():
            # A replayed known token invalidates every active session for that user.
            if token: await self.db.execute(update(RefreshToken).where(RefreshToken.user_id == token.user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=utc_now())); await self.db.commit()
            return None
        user = await self.users.get_user_by_id(token.user_id)
        if not user or not user.is_active: return None
        token.revoked_at = utc_now()  # rotation: this value can never be used twice
        session = await self.issue_session(user)
        await self.db.commit()
        return session

    async def revoke(self, raw: str) -> None:
        token = (await self.db.execute(select(RefreshToken).where(RefreshToken.token_hash == token_hash(raw)))).scalar_one_or_none()
        if token and not token.revoked_at: token.revoked_at = utc_now(); await self.db.commit()

    async def revoke_all(self, user_id) -> None:
        await self.db.execute(update(RefreshToken).where(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None)).values(revoked_at=utc_now())); await self.db.commit()

    async def create_one_time_token(self, user: User, purpose: TokenPurpose) -> str:
        raw = opaque_token(); self.db.add(OneTimeToken(user_id=user.id, purpose=purpose.value, token_hash=token_hash(raw), expires_at=utc_now() + timedelta(hours=24 if purpose == TokenPurpose.EMAIL_VERIFICATION else 1)))
        await self.db.commit(); return raw

    async def consume_one_time_token(self, raw: str, purpose: TokenPurpose) -> User | None:
        row = (await self.db.execute(select(OneTimeToken).where(OneTimeToken.token_hash == token_hash(raw), OneTimeToken.purpose == purpose.value))).scalar_one_or_none()
        if not row or row.consumed_at or row.expires_at <= utc_now(): return None
        row.consumed_at = utc_now(); user = await self.users.get_user_by_id(row.user_id)
        await self.db.commit(); return user
