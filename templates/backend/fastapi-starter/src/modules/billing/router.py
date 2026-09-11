from datetime import datetime
from secrets import compare_digest
from uuid import UUID
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.core.exceptions import AppError
from src.db.database import get_db
from src.modules.auth.security.tokens import get_current_user
from src.modules.organizations.router import require_role
from src.modules.users.model import MembershipRole, Subscription, User

router = APIRouter(prefix="/billing", tags=["billing"])
class SubscriptionUpdate(BaseModel): plan: str = Field(min_length=1, max_length=60); status: str = Field(default="active", max_length=40); seats: int = Field(default=1, ge=1); provider: str = Field(default="manual", max_length=40); provider_customer_id: str | None = None; provider_subscription_id: str | None = None; current_period_end: datetime | None = None
class WebhookEvent(BaseModel): event_id: str = Field(min_length=1, max_length=255); organization_id: UUID; subscription: SubscriptionUpdate

@router.get("/organizations/{org_id}")
async def get_subscription(org_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.BILLING})
    subscription = (await db.execute(select(Subscription).where(Subscription.organization_id == org_id))).scalar_one_or_none()
    return subscription or {"organization_id": str(org_id), "plan": "free", "status": "active", "seats": 1, "provider": "manual"}
@router.post("/webhooks/{provider}", status_code=202)
async def webhook(provider: str, event: WebhookEvent, webhook_secret: str | None = Header(default=None, alias="X-Webhook-Secret"), db: AsyncSession = Depends(get_db)):
    # Provider signature verification is intentionally delegated to provider adapters/configuration.
    import os
    expected = os.getenv(f"{provider.upper()}_WEBHOOK_SECRET")
    if not expected or not webhook_secret or not compare_digest(webhook_secret, expected): raise AppError("Webhook signature is invalid.", code="INVALID_WEBHOOK", status_code=401)
    item = (await db.execute(select(Subscription).where(Subscription.organization_id == event.organization_id))).scalar_one_or_none()
    if item and item.metadata_.get("last_event_id") == event.event_id: return {"accepted": True, "duplicate": True}
    if not item: item = Subscription(organization_id=event.organization_id, provider=provider); db.add(item)
    for key, value in event.subscription.model_dump().items(): setattr(item, key, value)
    item.provider = provider; item.metadata_ = {**item.metadata_, "last_event_id": event.event_id}; await db.commit(); return {"accepted": True, "duplicate": False}
