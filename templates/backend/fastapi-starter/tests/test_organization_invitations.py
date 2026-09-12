import asyncio
import unittest
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from src.modules.organizations import router
from src.modules.users.model import MembershipRole


class Result:
    def __init__(self, value=None):
        self.value = value

    def scalar_one_or_none(self):
        return self.value

    def one_or_none(self):
        return self.value


class RecordingSession:
    def __init__(self, results):
        self.results = iter(results)
        self.statements = []
        self.commits = 0
        self.rollbacks = 0

    async def execute(self, statement):
        self.statements.append(statement)
        return Result(next(self.results))

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class OrganizationInvitationTests(unittest.TestCase):
    def test_creating_an_invitation_uses_the_active_invitation_unique_index(self):
        invitation_id = uuid4()
        session = RecordingSession([invitation_id])
        user = SimpleNamespace(id=uuid4())
        payload = router.InviteCreate(email="member@example.com", role=MembershipRole.MEMBER)

        with (
            patch.object(router, "require_role", new=AsyncMock()),
            patch.object(router, "opaque_token", return_value="raw-token"),
            patch.object(router, "send_secure_email", new=AsyncMock()) as deliver,
        ):
            response = asyncio.run(router.invite(uuid4(), payload, user, session))

        statement = str(session.statements[0].compile(dialect=postgresql.dialect()))
        self.assertIn("ON CONFLICT (organization_id, email) WHERE accepted_at IS NULL AND cancelled_at IS NULL DO NOTHING", statement)
        self.assertEqual(response, {"id": str(invitation_id), "accepted": False})
        self.assertEqual(session.commits, 1)
        deliver.assert_awaited_once()

    def test_accepting_an_invitation_claims_it_and_upserts_membership(self):
        organization_id = uuid4()
        session = RecordingSession([SimpleNamespace(organization_id=organization_id, role="member"), None])
        user = SimpleNamespace(id=uuid4(), email="member@example.com")

        asyncio.run(router.accept_invitation(router.AcceptInvite(token="raw-token"), user, session))

        claim = str(session.statements[0].compile(dialect=postgresql.dialect()))
        membership = str(session.statements[1].compile(dialect=postgresql.dialect()))
        self.assertIn("accepted_at IS NULL", claim)
        self.assertIn("cancelled_at IS NULL", claim)
        self.assertIn("RETURNING invitations.organization_id, invitations.role", claim)
        self.assertIn("ON CONFLICT (organization_id, user_id) DO NOTHING", membership)
        self.assertEqual(session.commits, 1)

    def test_reaccepting_a_completed_invitation_is_a_noop_for_the_same_email(self):
        now = router.utc_now()
        session = RecordingSession([None, SimpleNamespace(accepted_at=now, email="member@example.com")])
        user = SimpleNamespace(id=uuid4(), email="member@example.com")

        asyncio.run(router.accept_invitation(router.AcceptInvite(token="raw-token"), user, session))

        self.assertEqual(len(session.statements), 2)
        self.assertEqual(session.commits, 0)

    def test_migration_enforces_one_active_invitation_without_losing_history(self):
        migration = (
            __import__("pathlib").Path(__file__).parents[1]
            / "alembic/versions/20260912_0003_atomic_invitations.py"
        ).read_text(encoding="utf-8")

        self.assertIn("cancelled_at", migration)
        self.assertIn("uq_invitations_active_org_email", migration)
        self.assertIn("accepted_at IS NULL AND cancelled_at IS NULL", migration)
