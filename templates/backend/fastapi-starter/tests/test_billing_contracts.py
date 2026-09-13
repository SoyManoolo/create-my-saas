import unittest
import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from src.core.config import settings
from src.core.exceptions import AppError
from src.modules.billing.service import BillingService


class BillingContractTests(unittest.TestCase):
    def test_unconfigured_billing_is_explicit_and_free_entitlements_are_validated(self):
        service = BillingService(AsyncMock(), replace(settings, stripe_secret_key=None, stripe_webhook_secret=None, stripe_price_plans="{}", billing_free_entitlements='{"api_calls":100}'))
        self.assertEqual(service.configuration(), {"configured": False, "provider": "stripe", "usageMeterConfigured": False, "plans": []})
        self.assertEqual(service.free_entitlements(), {"api_calls": 100})

    def test_only_allowlisted_prices_are_accepted(self):
        service = BillingService(AsyncMock(), replace(settings, stripe_secret_key="sk_test", stripe_webhook_secret="whsec_test", stripe_price_plans='{"price_allowed":{"name":"pro","entitlements":{"api_calls":null}}}'))
        self.assertIn("price_allowed", service.price_plans())
        self.assertEqual(service.configuration()["plans"], [{"priceId": "price_allowed", "name": "pro", "entitlements": {"api_calls": None}}])
        with self.assertRaises(AppError) as error:
            asyncio.run(service.checkout(uuid4(), "price_not_allowed", 1, uuid4()))
        self.assertEqual(error.exception.code, "BILLING_PRICE_NOT_AVAILABLE")

    def test_webhook_requires_stripe_signature_and_browser_cannot_report_usage(self):
        client = TestClient(app)
        response = client.post("/billing/webhooks/stripe", content=b"{}")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(client.post(f"/billing/organizations/{uuid4()}/usage").status_code, 404)
        client.close()

    def test_stripe_settings_must_be_configured_as_a_pair(self):
        with self.assertRaisesRegex(RuntimeError, "configured together"):
            replace(settings, stripe_secret_key="sk_test", stripe_webhook_secret=None).validate()
        with self.assertRaisesRegex(RuntimeError, "at least one plan"):
            replace(settings, stripe_secret_key="sk_test", stripe_webhook_secret="whsec_test", stripe_price_plans="{}").validate()

    def test_checkout_and_portal_audit_only_safe_business_metadata(self):
        class Session:
            def __init__(self):
                self.added = []
                self.commits = 0

            def add(self, value):
                self.added.append(value)

            async def commit(self):
                self.commits += 1

        config = replace(
            settings,
            stripe_secret_key="sk_test",
            stripe_webhook_secret="whsec_test",
            stripe_price_plans='{"price_allowed":{"name":"pro","entitlements":{}}}',
        )
        organization_id, actor_id = uuid4(), uuid4()
        db = Session()
        service = BillingService(db, config)
        service._subscription = AsyncMock(return_value=SimpleNamespace(provider_customer_id="cus_secret"))
        with patch("src.modules.billing.service.stripe.checkout.Session.create", return_value=SimpleNamespace(url="https://checkout.example", id="cs_secret")):
            result = asyncio.run(service.checkout(organization_id, "price_allowed", 2, actor_id))
        self.assertEqual(result["sessionId"], "cs_secret")
        checkout_event = db.added[-1]
        self.assertEqual(checkout_event.metadata_, {"provider": "stripe", "plan": "pro", "quantity": 2})
        self.assertNotIn("cs_secret", repr(checkout_event.__dict__))
        self.assertNotIn("cus_secret", repr(checkout_event.__dict__))

        db.added.clear()
        with patch("src.modules.billing.service.stripe.billing_portal.Session.create", return_value=SimpleNamespace(url="https://portal.example", id="bps_secret")):
            asyncio.run(service.portal(organization_id, actor_id))
        portal_event = db.added[-1]
        self.assertEqual(portal_event.metadata_, {"provider": "stripe"})
        self.assertNotIn("bps_secret", repr(portal_event.__dict__))
