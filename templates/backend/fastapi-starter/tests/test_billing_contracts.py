import unittest
import asyncio
from dataclasses import replace
from unittest.mock import AsyncMock
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from src.core.config import settings
from src.core.exceptions import AppError
from src.modules.billing.service import BillingService


class BillingContractTests(unittest.TestCase):
    def test_unconfigured_billing_is_explicit_and_free_entitlements_are_validated(self):
        service = BillingService(AsyncMock(), replace(settings, stripe_secret_key=None, stripe_webhook_secret=None, stripe_price_plans="{}", billing_free_entitlements='{"api_calls":100}'))
        self.assertEqual(service.configuration(), {"configured": False, "provider": "stripe", "usageMeterConfigured": False})
        self.assertEqual(service.free_entitlements(), {"api_calls": 100})

    def test_only_allowlisted_prices_are_accepted(self):
        service = BillingService(AsyncMock(), replace(settings, stripe_secret_key="sk_test", stripe_webhook_secret="whsec_test", stripe_price_plans='{"price_allowed":{"name":"pro","entitlements":{"api_calls":null}}}'))
        self.assertIn("price_allowed", service.price_plans())
        with self.assertRaises(AppError) as error:
            asyncio.run(service.checkout(uuid4(), "price_not_allowed", 1))
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
