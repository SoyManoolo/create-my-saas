import unittest
from unittest.mock import AsyncMock, patch
from datetime import timedelta
from uuid import uuid4

import jwt
from fastapi.testclient import TestClient

from src.core.config import settings
from src.db.database import get_db
from main import app
from src.modules.auth.dependencies import get_user_repository
from src.modules.auth.security.tokens import utc_now
from src.modules.users.model import User
from src.modules.auth.service import AuthService
from src.modules.users.model import TokenPurpose


class InMemorySession:
    """Small async-session seam used to exercise the HTTP authentication flow."""

    def __init__(self):
        self.records = []

    def add(self, record):
        self.records.append(record)

    async def commit(self):
        pass

    async def execute(self, _statement):
        # HTTP tests do not emulate SQL; this seam only needs to accept the
        # conditional token updates issued by the real service.
        return InMemoryResult()


class InMemoryResult:
    def scalar_one_or_none(self):
        return None


class InMemoryUserRepository:
    def __init__(self):
        self.users_by_email = {}
        self.users_by_id = {}

    async def create_user(self, user: User) -> User:
        user.id = uuid4()
        user.email_verified = False
        user.is_active = True
        self.users_by_email[user.email] = user
        self.users_by_id[str(user.id)] = user
        return user

    async def get_user_by_email(self, email: str) -> User | None:
        return self.users_by_email.get(email.lower())

    async def get_user_by_id(self, user_id) -> User | None:
        return self.users_by_id.get(str(user_id))

    async def save(self, user: User) -> User:
        self.users_by_email[user.email] = user
        self.users_by_id[str(user.id)] = user
        return user


class AuthenticationApiTests(unittest.TestCase):
    registration = {
        "email": "person@example.com",
        "password": "password123",
        "name": "Person Example",
    }

    def setUp(self):
        self.db = InMemorySession()
        self.users = InMemoryUserRepository()

        async def override_db():
            yield self.db

        async def override_user_repository():
            return self.users

        app.dependency_overrides[get_db] = override_db
        app.dependency_overrides[get_user_repository] = override_user_repository
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        app.dependency_overrides.clear()

    def register(self, **overrides):
        return self.client.post("/auth/register", json=self.registration | overrides)

    def login(self, **overrides):
        credentials = {
            "email": self.registration["email"],
            "password": self.registration["password"],
        } | overrides
        return self.client.post("/auth/login", json=credentials)

    def test_register_creates_a_public_user_and_rejects_duplicates(self):
        response = self.register()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["email"], self.registration["email"])
        self.assertEqual(response.json()["name"], self.registration["name"])
        self.assertFalse(response.json()["email_verified"])
        self.assertTrue(response.json()["is_active"])
        self.assertNotIn("password_hash", response.json())

        duplicate = self.register()
        self.assertEqual(duplicate.status_code, 409)
        self.assertEqual(duplicate.json()["error"]["code"], "EMAIL_ALREADY_EXISTS")

    def test_login_returns_tokens_and_rejects_invalid_credentials(self):
        self.register()

        response = self.login()
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json()["accessToken"], str)
        self.assertEqual(response.json()["user"]["email"], self.registration["email"])
        self.assertIsInstance(response.json()["access_token"], str)
        self.assertNotIn("refresh_token", response.json())
        self.assertIn(f"{settings.refresh_cookie_name}=", response.headers["set-cookie"])
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        cookies = response.headers.get_list("set-cookie")
        refresh_cookie = next(cookie for cookie in cookies if cookie.startswith(f"{settings.refresh_cookie_name}="))
        csrf_cookie = next(cookie for cookie in cookies if cookie.startswith(f"{settings.csrf_cookie_name}="))
        self.assertIn("; Path=/auth;", refresh_cookie)
        self.assertIn("; Path=/;", csrf_cookie)
        self.assertEqual(response.json()["token_type"], "bearer")

        invalid = self.login(password="not-the-password")
        self.assertEqual(invalid.status_code, 401)
        self.assertEqual(invalid.json()["error"]["code"], "INVALID_CREDENTIALS")

    def test_users_me_returns_the_authenticated_user(self):
        self.register()
        token = self.login().json()["access_token"]

        response = self.client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["email"], self.registration["email"])
        self.assertNotIn("password_hash", response.json())

    def test_inactive_user_cannot_access_protected_routes(self):
        self.register()
        token = self.login().json()["access_token"]
        self.users.users_by_email[self.registration["email"]].is_active = False

        response = self.client.get("/users/me", headers={"Authorization": f"Bearer {token}"})

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "USER_INACTIVE")

    def test_invalid_and_expired_jwts_are_rejected(self):
        self.register()
        user = self.users.users_by_email[self.registration["email"]]
        expired_token = jwt.encode(
            {"sub": str(user.id), "type": "access", "exp": utc_now() - timedelta(seconds=1)},
            settings.secret_key,
            algorithm=settings.jwt_algorithm,
        )

        cases = {
            "not-a-jwt": "INVALID_ACCESS_TOKEN",
            expired_token: "EXPIRED_TOKEN",
        }
        for token, expected_error_code in cases.items():
            with self.subTest(token=token):
                response = self.client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response.json()["error"]["code"], expected_error_code)

    def test_authentication_e2e_register_login_and_current_user(self):
        registered = self.register()
        self.assertEqual(registered.status_code, 201)

        logged_in = self.login()
        self.assertEqual(logged_in.status_code, 200)

        current_user = self.client.get(
            "/users/me",
            headers={"Authorization": f"Bearer {logged_in.json()['access_token']}"},
        )
        self.assertEqual(current_user.status_code, 200)
        self.assertEqual(current_user.json()["id"], registered.json()["id"])

    def test_password_reset_does_not_reveal_account_or_delivery_status(self):
        user = User(id=uuid4(), email=self.registration["email"], name="Person", password_hash="hash", is_active=True)
        self.users.users_by_email[user.email] = user
        self.users.users_by_id[str(user.id)] = user

        from src.core.email import EmailDeliveryError
        with patch.object(AuthService, "send_one_time_token", new=AsyncMock(side_effect=EmailDeliveryError("mail provider unavailable"))):
            known = self.client.post("/users/password-reset/request", json={"email": user.email})
        unknown = self.client.post("/users/password-reset/request", json={"email": "missing@example.com"})

        self.assertEqual(known.status_code, 202)
        self.assertEqual(known.json(), {"accepted": True})
        self.assertEqual((unknown.status_code, unknown.json()), (202, {"accepted": True}))

    def test_verification_confirms_the_user_without_exposing_a_token(self):
        user = User(id=uuid4(), email=self.registration["email"], name="Person", password_hash="hash", email_verified=False, is_active=True)
        self.users.users_by_email[user.email] = user
        self.users.users_by_id[str(user.id)] = user

        with patch.object(AuthService, "consume_one_time_token", new=AsyncMock(return_value=user)) as consume:
            response = self.client.post("/users/email-verification/confirm", json={"token": "a" * 32})

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["email_verified"])
        consume.assert_awaited_once_with("a" * 32, TokenPurpose.EMAIL_VERIFICATION)

    def test_browser_contract_routes_are_available(self):
        registered_routes = []
        for route in app.routes:
            registered_routes.extend(getattr(getattr(route, "original_router", None), "routes", [route]))
        routes = {(method, route.path) for route in registered_routes for method in getattr(route, "methods", set())}
        expected = {
            ("POST", "/auth/password/reset/request"),
            ("POST", "/auth/password/reset/confirm"),
            ("POST", "/auth/email/verify"),
            ("POST", "/auth/email/resend"),
            ("POST", "/auth/password/change"),
        }
        self.assertTrue(expected.issubset(routes))
