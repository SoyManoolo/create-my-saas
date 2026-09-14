from uuid import UUID

from fastapi import APIRouter, Depends, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.database import get_db
from src.modules.auth.security.tokens import get_current_user
from src.modules.billing.service import BillingService
from src.modules.organizations.access import require_role
from src.modules.users.model import MembershipRole, User

router = APIRouter(prefix="/billing", tags=["billing"])


class CreateCheckout(BaseModel):
    price_id: str = Field(pattern=r"^price_[A-Za-z0-9]+$")
    quantity: int = Field(default=1, ge=1, le=1000)


async def require_billing_role(org_id: UUID, user: User, db: AsyncSession) -> None:
    await require_role(org_id, user, db, {MembershipRole.OWNER, MembershipRole.ADMIN, MembershipRole.BILLING})


@router.get("/organizations/{org_id}")
async def get_subscription(org_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_billing_role(org_id, user, db)
    return await BillingService(db).snapshot(org_id)


@router.get("/organizations/{org_id}/configuration")
async def get_configuration(org_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_billing_role(org_id, user, db)
    return BillingService(db).configuration()


@router.post("/organizations/{org_id}/checkout")
async def create_checkout(org_id: UUID, body: CreateCheckout, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_billing_role(org_id, user, db)
    return await BillingService(db).checkout(org_id, body.price_id, body.quantity, user.id)


@router.post("/organizations/{org_id}/portal")
async def create_portal(org_id: UUID, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await require_billing_role(org_id, user, db)
    return await BillingService(db).portal(org_id, user.id)


@router.post("/webhooks/stripe", status_code=200)
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"), db: AsyncSession = Depends(get_db)):
    return await BillingService(db).handle_webhook(await request.body(), stripe_signature)
