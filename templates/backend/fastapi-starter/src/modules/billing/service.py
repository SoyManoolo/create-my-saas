"""Trusted Stripe billing operations.

Browser clients may start Checkout or the Customer Portal, but subscription
state only changes after a verified Stripe webhook. Product code, rather than
an HTTP endpoint, records billable usage through ``record_usage``.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import stripe
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.config import Settings, settings
from src.core.exceptions import AppError
from src.db.base import utc_now
from src.modules.users.model import BillingEntitlement, BillingWebhookEvent, Organization, Subscription, UsageRecord

_ENTITLEMENT_KEY = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,99}$")


class BillingService:
    def __init__(self, db: AsyncSession, config: Settings = settings):
        self.db = db
        self.config = config

    def configuration(self) -> dict[str, Any]:
        plans = self.price_plans()
        return {
            "configured": self.is_stripe_configured(),
            "provider": "stripe",
            "usageMeterConfigured": bool(self.config.stripe_usage_event_name),
            "plans": [
                {"priceId": price_id, "name": plan["name"], "entitlements": plan["entitlements"]}
                for price_id, plan in plans.items()
            ],
        }

    async def snapshot(self, organization_id: UUID) -> dict[str, Any]:
        subscription = await self._subscription(organization_id, create=False)
        if not subscription:
            return {
                "organizationId": str(organization_id), "provider": "manual", "plan": "free", "status": "active", "seats": 1,
                "currentPeriodStart": None, "currentPeriodEnd": None, "cancelAtPeriodEnd": False,
                "entitlements": [{"key": key, "limit": limit, "enabled": True, "source": "free", "expiresAt": None} for key, limit in self.free_entitlements().items()],
                "usage": [],
            }
        entitlements = list((await self.db.execute(select(BillingEntitlement).where(BillingEntitlement.organization_id == organization_id).order_by(BillingEntitlement.key))).scalars())
        usage = await self._usage_totals(organization_id, subscription.current_period_start or subscription.updated_at)
        return {
            "organizationId": str(organization_id), "provider": subscription.provider, "plan": subscription.plan,
            "status": subscription.status, "seats": subscription.seats, "currentPeriodStart": subscription.current_period_start,
            "currentPeriodEnd": subscription.current_period_end, "cancelAtPeriodEnd": subscription.cancel_at_period_end,
            "entitlements": [self._entitlement_json(row) for row in entitlements], "usage": usage,
        }

    async def checkout(self, organization_id: UUID, price_id: str, quantity: int) -> dict[str, Any]:
        if not self.is_stripe_configured():
            return {"configured": False, "url": None, "sessionId": None}
        plan = self.price_plans().get(price_id)
        if not plan:
            raise AppError("This billing plan is not available.", code="BILLING_PRICE_NOT_AVAILABLE", status_code=400)
        subscription = await self._subscription(organization_id, create=True)
        assert subscription is not None
        self._configure_stripe()
        customer_id = subscription.provider_customer_id or await self._create_customer(organization_id, subscription)
        try:
            session = stripe.checkout.Session.create(
                mode="subscription", customer=customer_id, client_reference_id=str(organization_id), line_items=[{"price": price_id, "quantity": quantity}],
                success_url=f"{self._frontend_url()}/organizations/{organization_id}/billing?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{self._frontend_url()}/organizations/{organization_id}/billing?checkout=cancelled",
                metadata={"organization_id": str(organization_id), "plan": plan["name"]},
                subscription_data={"metadata": {"organization_id": str(organization_id), "plan": plan["name"]}},
            )
        except stripe.StripeError as error:
            raise AppError("The billing provider could not create Checkout.", code="BILLING_PROVIDER_ERROR", status_code=502) from error
        if not session.url:
            raise AppError("The billing provider did not return a Checkout URL.", code="BILLING_PROVIDER_ERROR", status_code=502)
        return {"configured": True, "url": session.url, "sessionId": session.id}

    async def portal(self, organization_id: UUID) -> dict[str, Any]:
        if not self.is_stripe_configured():
            return {"configured": False, "url": None, "reason": "Stripe billing is not configured."}
        subscription = await self._subscription(organization_id, create=False)
        if not subscription or not subscription.provider_customer_id:
            raise AppError("Start Checkout before opening the billing portal.", code="BILLING_CUSTOMER_NOT_FOUND", status_code=409)
        self._configure_stripe()
        params: dict[str, Any] = {"customer": subscription.provider_customer_id, "return_url": f"{self._frontend_url()}/organizations/{organization_id}/billing"}
        if self.config.stripe_portal_configuration_id:
            params["configuration"] = self.config.stripe_portal_configuration_id
        try:
            session = stripe.billing_portal.Session.create(**params)
        except stripe.StripeError as error:
            raise AppError("The billing provider could not create the portal.", code="BILLING_PROVIDER_ERROR", status_code=502) from error
        return {"configured": True, "url": session.url}

    async def record_usage(self, organization_id: UUID, metric: str, quantity: int, idempotency_key: str, recorded_at: datetime | None = None) -> dict[str, Any]:
        """Record trusted product usage; intentionally not exposed as an HTTP route."""
        if not _ENTITLEMENT_KEY.fullmatch(metric) or quantity < 1 or len(idempotency_key) not in range(1, 256):
            raise AppError("Usage requires a valid metric, positive quantity and idempotency key.", code="INVALID_USAGE_RECORD", status_code=400)
        existing = (await self.db.execute(select(UsageRecord).where(UsageRecord.organization_id == organization_id, UsageRecord.idempotency_key == idempotency_key))).scalar_one_or_none()
        if existing:
            return {"record": existing, "reportedToProvider": existing.reported_to_provider}
        subscription = await self._subscription(organization_id, create=False)
        reported = False
        if self.can_report_usage() and subscription and subscription.provider == "stripe" and subscription.provider_customer_id:
            try:
                self._configure_stripe()
                stripe.billing.MeterEvent.create(event_name=self.config.stripe_usage_event_name, identifier=idempotency_key,
                    timestamp=int((recorded_at or utc_now()).timestamp()), payload={"stripe_customer_id": subscription.provider_customer_id, "value": str(quantity)})
                reported = True
            except stripe.StripeError as error:
                raise AppError("The billing provider could not record usage.", code="BILLING_PROVIDER_ERROR", status_code=502) from error
        record = UsageRecord(organization_id=organization_id, metric=metric, quantity=quantity, idempotency_key=idempotency_key,
                             reported_to_provider=reported, recorded_at=recorded_at or utc_now())
        self.db.add(record)
        try:
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            existing = (await self.db.execute(select(UsageRecord).where(UsageRecord.organization_id == organization_id, UsageRecord.idempotency_key == idempotency_key))).scalar_one()
            return {"record": existing, "reportedToProvider": reported}
        return {"record": record, "reportedToProvider": reported}

    async def assert_entitled(self, organization_id: UUID, key: str, quantity: int = 1) -> None:
        if quantity < 1:
            raise AppError("Entitlement quantity must be positive.", code="INVALID_ENTITLEMENT_QUANTITY", status_code=400)
        entitlement = (await self.db.execute(select(BillingEntitlement).where(BillingEntitlement.organization_id == organization_id, BillingEntitlement.key == key))).scalar_one_or_none()
        if not entitlement or not entitlement.enabled or (entitlement.expires_at and entitlement.expires_at <= utc_now()):
            raise AppError("Your plan does not include this feature.", code="ENTITLEMENT_REQUIRED", status_code=403)
        if entitlement.limit_value is None:
            return
        subscription = await self._subscription(organization_id, create=True)
        assert subscription is not None
        if await self._usage_for_metric(organization_id, key, subscription.current_period_start or subscription.updated_at) + quantity > entitlement.limit_value:
            raise AppError("Your plan usage limit has been reached.", code="ENTITLEMENT_LIMIT_REACHED", status_code=403)

    async def handle_webhook(self, raw_body: bytes, signature: str | None) -> dict[str, bool]:
        if not self.config.stripe_webhook_secret:
            raise AppError("Stripe webhooks are not configured.", code="BILLING_NOT_CONFIGURED", status_code=503)
        if not signature:
            raise AppError("Stripe webhook signature is invalid.", code="INVALID_WEBHOOK_SIGNATURE", status_code=400)
        try:
            event = stripe.Webhook.construct_event(raw_body, signature, self.config.stripe_webhook_secret, tolerance=self.config.stripe_webhook_tolerance_seconds)
        except (ValueError, stripe.SignatureVerificationError) as error:
            raise AppError("Stripe webhook signature is invalid.", code="INVALID_WEBHOOK_SIGNATURE", status_code=400) from error
        try:
            async with self.db.begin():
                delivery = BillingWebhookEvent(provider="stripe", provider_event_id=event.id)
                self.db.add(delivery)
                await self.db.flush()
                await self._apply_stripe_event(event)
                delivery.processed_at = utc_now()
            return {"accepted": True, "duplicate": False}
        except IntegrityError:
            await self.db.rollback()
            duplicate = (await self.db.execute(select(BillingWebhookEvent.id).where(
                BillingWebhookEvent.provider == "stripe", BillingWebhookEvent.provider_event_id == event.id
            ))).scalar_one_or_none()
            if duplicate:
                return {"accepted": True, "duplicate": True}
            raise

    async def _apply_stripe_event(self, event: Any) -> None:
        if event.type == "checkout.session.completed":
            session = event.data.object
            organization_id = self._organization_id(self._value(session, "metadata", {}).get("organization_id") or self._value(session, "client_reference_id"))
            customer_id = self._object_id(self._value(session, "customer"))
            if organization_id and customer_id:
                await self._bind_customer(organization_id, customer_id)
        elif event.type.startswith("customer.subscription."):
            await self._sync_subscription(event.data.object)

    async def _sync_subscription(self, stripe_subscription: Any) -> None:
        customer_id = self._object_id(self._value(stripe_subscription, "customer"))
        if not customer_id:
            raise AppError("Stripe subscription customer is missing.", code="INVALID_BILLING_WEBHOOK", status_code=400)
        metadata = self._value(stripe_subscription, "metadata", {})
        metadata_org_id = self._organization_id(metadata.get("organization_id"))
        subscription = (await self.db.execute(select(Subscription).where(Subscription.provider_customer_id == customer_id))).scalar_one_or_none()
        if subscription and metadata_org_id and subscription.organization_id != metadata_org_id:
            raise AppError("Stripe customer belongs to another organization.", code="BILLING_ORGANIZATION_MISMATCH", status_code=400)
        organization_id = subscription.organization_id if subscription else metadata_org_id
        if not organization_id:
            return
        if not subscription:
            subscription = Subscription(organization_id=organization_id, provider="stripe", provider_customer_id=customer_id)
            self.db.add(subscription)
        if subscription.provider_subscription_id and subscription.provider_subscription_id != self._value(stripe_subscription, "id"):
            raise AppError("Organization already has a different Stripe subscription.", code="BILLING_SUBSCRIPTION_MISMATCH", status_code=400)
        item = (self._value(self._value(stripe_subscription, "items", {}), "data", []) or [{}])[0]
        price_id = self._object_id(self._value(item, "price"))
        plan = self.price_plans().get(price_id or "")
        subscription.provider, subscription.provider_customer_id = "stripe", customer_id
        subscription.provider_subscription_id, subscription.plan = self._value(stripe_subscription, "id"), plan["name"] if plan else "unknown"
        subscription.status = self._value(stripe_subscription, "status")
        subscription.current_period_start, subscription.current_period_end = self._epoch(self._value(item, "current_period_start")), self._epoch(self._value(item, "current_period_end"))
        subscription.cancel_at_period_end = bool(self._value(stripe_subscription, "cancel_at_period_end"))
        active = subscription.status in {"active", "trialing"} and plan is not None
        await self._replace_entitlements(organization_id, plan["entitlements"] if active else self.free_entitlements(), plan["name"] if active else "free", subscription.current_period_end if active else None)

    async def _subscription(self, organization_id: UUID, create: bool) -> Subscription | None:
        subscription = (await self.db.execute(select(Subscription).where(Subscription.organization_id == organization_id))).scalar_one_or_none()
        if subscription or not create:
            return subscription
        subscription = Subscription(organization_id=organization_id, provider="manual", plan="free", status="active")
        self.db.add(subscription)
        await self._replace_entitlements(organization_id, self.free_entitlements(), "free", None)
        await self.db.flush()
        return subscription

    async def _create_customer(self, organization_id: UUID, subscription: Subscription) -> str:
        organization = await self.db.get(Organization, organization_id)
        if not organization:
            raise AppError("Organization was not found.", code="ORGANIZATION_NOT_FOUND", status_code=404)
        try:
            customer = stripe.Customer.create(name=organization.name, metadata={"organization_id": str(organization_id)}, idempotency_key=f"billing-customer:{organization_id}")
        except stripe.StripeError as error:
            raise AppError("The billing provider could not create a customer.", code="BILLING_PROVIDER_ERROR", status_code=502) from error
        subscription.provider, subscription.provider_customer_id = "stripe", customer.id
        await self.db.commit()
        return customer.id

    async def _bind_customer(self, organization_id: UUID, customer_id: str) -> None:
        subscription = await self._subscription(organization_id, create=True)
        assert subscription is not None
        if subscription.provider_customer_id and subscription.provider_customer_id != customer_id:
            raise AppError("Stripe customer belongs to another organization.", code="BILLING_CUSTOMER_MISMATCH", status_code=400)
        subscription.provider, subscription.provider_customer_id = "stripe", customer_id

    async def _replace_entitlements(self, organization_id: UUID, values: dict[str, int | None], source: str, expires_at: datetime | None) -> None:
        await self.db.execute(delete(BillingEntitlement).where(BillingEntitlement.organization_id == organization_id))
        self.db.add_all([BillingEntitlement(organization_id=organization_id, key=key, limit_value=limit, enabled=True, source=source, expires_at=expires_at) for key, limit in values.items()])

    async def _usage_totals(self, organization_id: UUID, since: datetime) -> list[dict[str, Any]]:
        rows = await self.db.execute(select(UsageRecord.metric, func.coalesce(func.sum(UsageRecord.quantity), 0)).where(UsageRecord.organization_id == organization_id, UsageRecord.recorded_at >= since).group_by(UsageRecord.metric).order_by(UsageRecord.metric))
        return [{"metric": metric, "quantity": quantity} for metric, quantity in rows]

    async def _usage_for_metric(self, organization_id: UUID, metric: str, since: datetime) -> int:
        return int((await self.db.execute(select(func.coalesce(func.sum(UsageRecord.quantity), 0)).where(UsageRecord.organization_id == organization_id, UsageRecord.metric == metric, UsageRecord.recorded_at >= since))).scalar_one())

    def is_stripe_configured(self) -> bool:
        return bool(self.config.stripe_secret_key and self.config.stripe_webhook_secret and self.price_plans())

    def can_report_usage(self) -> bool:
        return self.is_stripe_configured() and bool(self.config.stripe_usage_event_name)

    def price_plans(self) -> dict[str, dict[str, Any]]:
        plans: dict[str, dict[str, Any]] = {}
        for price_id, plan in self._json_object(self.config.stripe_price_plans, "STRIPE_PRICE_PLANS").items():
            if not re.fullmatch(r"price_[A-Za-z0-9]+", price_id) or not isinstance(plan, dict) or not isinstance(plan.get("name"), str) or not plan["name"].strip():
                raise AppError("STRIPE_PRICE_PLANS contains an invalid plan.", code="INVALID_BILLING_CONFIGURATION", status_code=500)
            plans[price_id] = {"name": plan["name"], "entitlements": self._validate_entitlements(plan.get("entitlements", {}), "STRIPE_PRICE_PLANS")}
        return plans

    def free_entitlements(self) -> dict[str, int | None]:
        return self._validate_entitlements(self._json_object(self.config.billing_free_entitlements, "BILLING_FREE_ENTITLEMENTS"), "BILLING_FREE_ENTITLEMENTS")

    @staticmethod
    def _json_object(raw: str, setting: str) -> dict[str, Any]:
        try:
            value = json.loads(raw)
        except json.JSONDecodeError as error:
            raise AppError(f"{setting} must be valid JSON.", code="INVALID_BILLING_CONFIGURATION", status_code=500) from error
        if not isinstance(value, dict):
            raise AppError(f"{setting} must be an object.", code="INVALID_BILLING_CONFIGURATION", status_code=500)
        return value

    @staticmethod
    def _validate_entitlements(value: Any, setting: str) -> dict[str, int | None]:
        if not isinstance(value, dict) or any(not _ENTITLEMENT_KEY.fullmatch(key) or (limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 0)) for key, limit in value.items()):
            raise AppError(f"{setting} contains an invalid entitlement.", code="INVALID_BILLING_CONFIGURATION", status_code=500)
        return value

    def _frontend_url(self) -> str: return self.config.frontend_url.rstrip("/")
    def _configure_stripe(self) -> None:
        if not self.config.stripe_secret_key:
            raise AppError("Stripe billing is not configured.", code="BILLING_NOT_CONFIGURED", status_code=503)
        stripe.api_key = self.config.stripe_secret_key
    @staticmethod
    def _value(obj: Any, key: str, default: Any = None) -> Any: return obj.get(key, default) if isinstance(obj, dict) else getattr(obj, key, default)
    @staticmethod
    def _object_id(value: Any) -> str | None: return value if isinstance(value, str) else BillingService._value(value, "id")
    @staticmethod
    def _organization_id(value: Any) -> UUID | None:
        try: return UUID(str(value))
        except (TypeError, ValueError): return None
    @staticmethod
    def _epoch(value: Any) -> datetime | None: return datetime.fromtimestamp(value, tz=timezone.utc) if isinstance(value, int) else None
    @staticmethod
    def _entitlement_json(row: BillingEntitlement) -> dict[str, Any]: return {"key": row.key, "limit": row.limit_value, "enabled": row.enabled, "source": row.source, "expiresAt": row.expires_at}
