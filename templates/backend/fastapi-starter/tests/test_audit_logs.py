import unittest
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient

from main import app
from src.modules.audit.service import AuditAction, record_audit_event


class RecordingSession:
    def __init__(self):
        self.added = []

    def add(self, value):
        self.added.append(value)


class AuditLogContractTests(unittest.TestCase):
    def test_metadata_is_allowlisted_and_rejects_tokens_or_provider_payloads(self):
        session = RecordingSession()
        event = record_audit_event(
            session,
            organization_id=uuid4(),
            actor_user_id=uuid4(),
            action=AuditAction.BILLING_CHECKOUT_CREATED,
            target_type="billing",
            metadata={"provider": "stripe", "plan": "pro", "quantity": 1},
        )
        self.assertIs(session.added[0], event)
        self.assertEqual(event.metadata_, {"provider": "stripe", "plan": "pro", "quantity": 1})
        with self.assertRaisesRegex(ValueError, "not allowed"):
            record_audit_event(
                session,
                organization_id=uuid4(),
                actor_user_id=uuid4(),
                action=AuditAction.BILLING_PORTAL_CREATED,
                target_type="billing",
                metadata={"provider": "stripe", "sessionId": "bps_secret"},
            )

    def test_owner_admin_audit_endpoint_is_registered(self):
        with TestClient(app) as client:
            response = client.get(f"/organizations/{uuid4()}/audit-logs")
        self.assertEqual(response.status_code, 401)

    def test_migration_is_append_only_and_contains_no_secret_or_payment_columns(self):
        migration = (Path(__file__).parents[1] / "alembic/versions/20260913_0005_audit_logs.py").read_text(encoding="utf-8")
        self.assertIn('down_revision = "20260912_0004"', migration)
        self.assertIn("ix_audit_logs_org_created_id", migration)
        for forbidden_column in ("token", "secret", "card", "payment_method", "provider_customer_id", "provider_session_id"):
            self.assertNotIn(f'sa.Column("{forbidden_column}"', migration)


if __name__ == "__main__":
    unittest.main()
