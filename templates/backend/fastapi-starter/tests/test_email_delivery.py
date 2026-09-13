import json
import unittest
from unittest.mock import patch

from src.core import email as email_module
from src.core.config import Settings


class FakeResponse:
    def __init__(self, status: int = 202):
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class EmailDeliveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_posts_the_shared_authenticated_adapter_contract(self):
        configured = Settings(
            environment="test",
            email_delivery_url="https://mail.example.test/send",
            email_delivery_token="delivery-token",
        )
        with (
            patch.object(email_module, "settings", configured),
            patch.object(email_module.request, "urlopen", return_value=FakeResponse()) as deliver,
        ):
            await email_module.send_secure_email(
                recipient="person@example.com",
                subject="Verify email",
                body="Use this one-time token",
            )

        adapter_request = deliver.call_args.args[0]
        self.assertEqual(adapter_request.full_url, "https://mail.example.test/send")
        self.assertEqual(adapter_request.get_method(), "POST")
        self.assertEqual(adapter_request.get_header("Authorization"), "Bearer delivery-token")
        self.assertEqual(adapter_request.get_header("Content-type"), "application/json")
        self.assertEqual(
            json.loads(adapter_request.data),
            {"to": "person@example.com", "subject": "Verify email", "text": "Use this one-time token"},
        )
        self.assertEqual(deliver.call_args.kwargs, {"timeout": 10})

    async def test_suppresses_unconfigured_delivery_only_outside_protected_environments(self):
        with (
            patch.object(email_module, "settings", Settings(environment="development")),
            patch.object(email_module.request, "urlopen") as deliver,
        ):
            await email_module.send_secure_email(recipient="person@example.com", subject="Subject", body="Text")
        deliver.assert_not_called()

        with patch.object(email_module, "settings", Settings(environment="staging")):
            with self.assertRaisesRegex(email_module.EmailDeliveryError, "not configured"):
                await email_module.send_secure_email(recipient="person@example.com", subject="Subject", body="Text")

    async def test_normalizes_adapter_and_network_failures(self):
        configured = Settings(
            environment="test",
            email_delivery_url="https://mail.example.test/send",
            email_delivery_token="delivery-token",
        )
        failures = [FakeResponse(500), email_module.error.URLError("adapter down")]
        for failure in failures:
            with self.subTest(failure=failure), patch.object(email_module, "settings", configured):
                effect = {"return_value": failure} if isinstance(failure, FakeResponse) else {"side_effect": failure}
                with patch.object(email_module.request, "urlopen", **effect):
                    with self.assertRaisesRegex(email_module.EmailDeliveryError, "unavailable"):
                        await email_module.send_secure_email(recipient="person@example.com", subject="Subject", body="Text")


if __name__ == "__main__":
    unittest.main()
