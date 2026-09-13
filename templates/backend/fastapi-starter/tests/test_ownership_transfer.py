import asyncio
import unittest
from uuid import uuid4

from sqlalchemy.dialects import postgresql

from src.core.exceptions import AppError
from src.modules.organizations.router import OwnershipTransfer, remove_member, transfer_ownership
from src.modules.users.model import Membership, MembershipRole, Organization, User


class FakeResult:
    def __init__(self, values):
        self.values = values

    def scalars(self):
        return self

    def all(self):
        return list(self.values)

    def scalar_one_or_none(self):
        return self.values[0] if self.values else None


class OwnershipState:
    def __init__(self, actor_role=MembershipRole.OWNER, *, target_active=True, target_is_member=True):
        self.organization_id = uuid4()
        self.actor = User(id=uuid4(), email="owner@example.com", name="Owner", is_active=True)
        self.target = User(id=uuid4(), email="target@example.com", name="Target", is_active=target_active)
        self.users = [self.actor, self.target]
        self.organization = Organization(id=self.organization_id, name="Acme", slug=f"acme-{uuid4()}", created_by_id=self.actor.id)
        self.memberships = [
            Membership(id=uuid4(), organization_id=self.organization_id, user_id=self.actor.id, role=actor_role.value),
        ]
        if target_is_member:
            self.memberships.append(
                Membership(id=uuid4(), organization_id=self.organization_id, user_id=self.target.id, role=MembershipRole.MEMBER.value)
            )
        self.lock = asyncio.Lock()

    def session(self):
        return OwnershipSession(self)


class OwnershipSession:
    def __init__(self, state):
        self.state = state
        self.step = 0
        self.locked = False
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        if self.step == 0:
            await self.state.lock.acquire()
            self.locked = True
            await asyncio.sleep(0)
            values = self.state.users
        elif self.step == 1:
            values = [self.state.organization]
        else:
            values = self.state.memberships
        self.step += 1
        return FakeResult(values)

    async def commit(self):
        self._release()

    async def rollback(self):
        self._release()

    def _release(self):
        if self.locked:
            self.locked = False
            self.state.lock.release()


class MemberMutationSession:
    def __init__(self, organization, membership):
        self.organization = organization
        self.membership = membership
        self.step = 0
        self.deleted = False

    async def execute(self, _statement):
        self.step += 1
        return FakeResult([self.organization] if self.step == 1 else [self.membership])

    async def delete(self, membership):
        self.deleted = membership is self.membership

    async def commit(self):
        pass


class OwnershipTransferTests(unittest.IsolatedAsyncioTestCase):
    async def test_owner_transfer_is_atomic_and_previous_owner_can_leave(self):
        state = OwnershipState()
        session = state.session()

        await transfer_ownership(
            state.organization_id,
            OwnershipTransfer(user_id=state.target.id),
            state.actor,
            session,
        )

        memberships = {membership.user_id: membership for membership in state.memberships}
        self.assertEqual(memberships[state.target.id].role, MembershipRole.OWNER.value)
        self.assertEqual(memberships[state.actor.id].role, MembershipRole.ADMIN.value)
        self.assertEqual(sum(membership.role == MembershipRole.OWNER.value for membership in state.memberships), 1)
        for statement in session.statements:
            self.assertIn("FOR UPDATE", str(statement.compile(dialect=postgresql.dialect())))

        leave_session = MemberMutationSession(state.organization, memberships[state.actor.id])
        await remove_member(state.organization_id, memberships[state.actor.id].id, state.actor, leave_session)
        self.assertTrue(leave_session.deleted)

    async def test_admin_and_member_cannot_transfer_ownership(self):
        for role in (MembershipRole.ADMIN, MembershipRole.MEMBER):
            with self.subTest(role=role):
                state = OwnershipState(actor_role=role)
                with self.assertRaises(AppError) as raised:
                    await transfer_ownership(
                        state.organization_id,
                        OwnershipTransfer(user_id=state.target.id),
                        state.actor,
                        state.session(),
                    )
                self.assertEqual((raised.exception.code, raised.exception.status_code), ("INSUFFICIENT_ROLE", 403))

    async def test_inactive_external_and_missing_users_are_not_eligible(self):
        states_and_targets = [
            (OwnershipState(target_active=False), None),
            (OwnershipState(target_is_member=False), None),
            (OwnershipState(), uuid4()),
            (OwnershipState(), "self"),
        ]
        for state, override_target in states_and_targets:
            with self.subTest(target=override_target, active=state.target.is_active, memberships=len(state.memberships)):
                target_id = state.actor.id if override_target == "self" else override_target or state.target.id
                with self.assertRaises(AppError) as raised:
                    await transfer_ownership(
                        state.organization_id,
                        OwnershipTransfer(user_id=target_id),
                        state.actor,
                        state.session(),
                    )
                self.assertEqual((raised.exception.code, raised.exception.status_code), ("OWNERSHIP_TARGET_NOT_ELIGIBLE", 409))
                self.assertEqual(state.memberships[0].role, MembershipRole.OWNER.value)

    async def test_concurrent_transfers_have_exactly_one_winner(self):
        state = OwnershipState()
        second_target = User(id=uuid4(), email="second@example.com", name="Second", is_active=True)
        state.users.append(second_target)
        state.memberships.append(
            Membership(id=uuid4(), organization_id=state.organization_id, user_id=second_target.id, role=MembershipRole.MEMBER.value)
        )

        first_session = state.session()
        second_session = state.session()
        results = await asyncio.gather(
            transfer_ownership(state.organization_id, OwnershipTransfer(user_id=state.target.id), state.actor, first_session),
            transfer_ownership(state.organization_id, OwnershipTransfer(user_id=second_target.id), state.actor, second_session),
            return_exceptions=True,
        )

        self.assertEqual(sum(result is None for result in results), 1)
        errors = [result for result in results if isinstance(result, AppError)]
        self.assertEqual([(error.code, error.status_code) for error in errors], [("INSUFFICIENT_ROLE", 403)])
        self.assertEqual(sum(membership.role == MembershipRole.OWNER.value for membership in state.memberships), 1)


if __name__ == "__main__":
    unittest.main()
