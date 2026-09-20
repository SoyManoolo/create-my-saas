import unittest
import asyncio
from unittest.mock import patch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from main import app
from src.core import middleware as middleware_module
from src.core.config.settings import Settings
from src.core.middleware import RateLimitMiddleware
from src.modules.auth.security.tokens import decode_access_token, encode_access_token, token_hash
from src.modules.auth.oauth import exchange_profile
from src.modules.users.schemas import ChangePassword, ResetPasswordConfirm, UserRegister


class SecurityContractTests(unittest.TestCase):
    def setUp(self):
        self.rate_limit_patch = patch.object(
            middleware_module,
            "settings",
            Settings(**{**middleware_module.settings.__dict__, "rate_limit_enabled": False}),
        )
        self.rate_limit_patch.start()

    def tearDown(self):
        self.rate_limit_patch.stop()

    def test_sensitive_authentication_routes_use_stricter_independent_buckets(self):
        limited_app = FastAPI()
        limited_app.add_middleware(RateLimitMiddleware)
        for path in (
            "/auth/register",
            "/auth/login",
            "/auth/password/reset/request",
            "/auth/password/reset/confirm",
            "/ordinary",
        ):
            limited_app.add_api_route(path, lambda: {"ok": True}, methods=["POST"])

        configured = Settings(
            rate_limit_enabled=True,
            rate_limit_requests=30,
            rate_limit_window_seconds=60,
            auth_rate_limit_requests=1,
            auth_rate_limit_window_seconds=120,
            redis_url=None,
        )
        with patch.object(middleware_module, "settings", configured), TestClient(limited_app) as client:
            self.assertEqual(client.post("/ordinary").status_code, 200)
            self.assertEqual(client.post("/ordinary").status_code, 200)
            for path in (
                "/auth/register",
                "/auth/login",
                "/auth/password/reset/request",
                "/auth/password/reset/confirm",
            ):
                self.assertEqual(client.post(path).status_code, 200, path)
                limited = client.post(path)
                self.assertEqual(limited.status_code, 429, path)
                self.assertEqual(limited.headers["retry-after"], "120", path)
                self.assertEqual(limited.json()["error"]["code"], "RATE_LIMITED", path)

    def test_access_token_has_access_type_and_subject(self):
        payload = decode_access_token(encode_access_token("user-123"))
        self.assertEqual(payload["sub"], "user-123")
        self.assertEqual(payload["type"], "access")

    def test_stored_tokens_are_hashed_deterministically(self):
        self.assertNotEqual(token_hash("refresh-value"), "refresh-value")
        self.assertEqual(token_hash("refresh-value"), token_hash("refresh-value"))

    def test_registration_rejects_password_without_number(self):
        with self.assertRaises(ValueError):
            UserRegister(email="person@example.com", name="Person", password="onlyletters")

    def test_password_policy_is_identical_for_register_change_and_reset(self):
        payloads = (
            lambda password: UserRegister(email="person@example.com", name="Person", password=password),
            lambda password: ChangePassword(currentPassword="old-password1", newPassword=password),
            lambda password: ResetPasswordConfirm(token="x" * 20, newPassword=password),
        )
        for payload in payloads:
            with self.subTest(payload=payload):
                payload("valid-password1")
                with self.assertRaises(ValueError):
                    payload("onlyletters")
                with self.assertRaises(ValueError):
                    payload("12345678")

    def test_public_api_has_no_subscription_mutation_endpoint(self):
        routes = {(method, route.path) for route in app.routes for method in getattr(route, "methods", set())}
        self.assertNotIn(("PUT", "/billing/organizations/{org_id}"), routes)

    def test_public_openapi_does_not_document_sensitive_one_time_tokens(self):
        document = str(app.openapi())
        self.assertNotIn("reset_token", document)
        self.assertNotIn("verification_token", document)
        self.assertNotIn("invite_token", document)

    def test_api_responses_have_security_headers(self):
        response = TestClient(app).get("/")
        self.assertEqual(response.headers["x-content-type-options"], "nosniff")
        self.assertEqual(response.headers["x-frame-options"], "DENY")
        self.assertIn("frame-ancestors 'none'", response.headers["content-security-policy"])

    def test_validation_errors_do_not_reflect_credentials(self):
        password = "secret-password1"
        response = TestClient(app).post("/auth/login", json={"email": "not-an-email", "password": password})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["error"]["code"], "HTTP_422")
        self.assertNotIn(password, response.text)

    def test_google_oauth_requires_a_verified_email(self):
        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"sub": "google-subject-1", "email": "person@example.com", "email_verified": True, "name": "Person"}]):
            profile = asyncio.run(exchange_profile("google", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))
        self.assertEqual((profile.email, profile.name, profile.provider_account_id), ("person@example.com", "Person", "google-subject-1"))

        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"sub": "google-subject-1", "email": "person@example.com", "email_verified": False}]):
            with self.assertRaisesRegex(Exception, "verified email"):
                asyncio.run(exchange_profile("google", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))

        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"sub": "google-subject-1", "email": "person@example.com"}]):
            with self.assertRaisesRegex(Exception, "verified email"):
                asyncio.run(exchange_profile("google", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))

    def test_github_oauth_uses_primary_verified_email_endpoint(self):
        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"id": 42, "login": "octocat"}, [{"email": "person@example.com", "primary": True, "verified": True}]]):
            profile = asyncio.run(exchange_profile("github", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))
        self.assertEqual((profile.email, profile.name, profile.provider_account_id), ("person@example.com", "octocat", "42"))

    def test_github_oauth_rejects_an_unverified_email_from_userinfo(self):
        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"id": 42, "email": "person@example.com", "login": "octocat"}, [{"email": "person@example.com", "primary": True, "verified": False}]]):
            with self.assertRaisesRegex(Exception, "verified email"):
                asyncio.run(exchange_profile("github", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))

    def test_oauth_rejects_profiles_without_stable_subjects(self):
        with patch("src.modules.auth.oauth._json_request", side_effect=[{"access_token": "provider-token"}, {"email": "person@example.com", "email_verified": True}]):
            with self.assertRaisesRegex(Exception, "stable account identifier"):
                asyncio.run(exchange_profile("google", "code", "verifier", {"token_url": "https://provider.test/token", "userinfo_url": "https://provider.test/user", "client_id": "id", "client_secret": "secret", "redirect_uri": "https://api.test/callback"}))


class RedisFailureContractTests(unittest.TestCase):
    class FailingRedis:
        async def eval(self, *_args):
            raise ConnectionError("Redis is unavailable")

        async def aclose(self):
            return None

    @staticmethod
    def limited_app():
        limited = FastAPI()
        limited.add_middleware(RateLimitMiddleware)
        limited.add_api_route("/limited", lambda: {"ok": True})
        return limited

    def test_redis_failure_falls_back_to_memory_only_outside_protected_environments(self):
        development = Settings(environment="development", rate_limit_enabled=True, rate_limit_requests=1, redis_url="redis://unused")
        with (
            patch.object(middleware_module, "settings", development),
            patch.object(middleware_module, "redis_from_url", return_value=self.FailingRedis()),
            TestClient(self.limited_app()) as client,
        ):
            self.assertEqual(client.get("/limited").status_code, 200)
            limited = client.get("/limited")
            self.assertEqual(limited.status_code, 429)
            self.assertEqual(limited.json()["error"]["code"], "RATE_LIMITED")

    def test_redis_failure_fails_closed_in_protected_environments(self):
        staging = Settings(environment="staging", rate_limit_enabled=True, redis_url="rediss://unused")
        with (
            patch.object(middleware_module, "settings", staging),
            patch.object(middleware_module, "redis_from_url", return_value=self.FailingRedis()),
            TestClient(self.limited_app()) as client,
        ):
            response = client.get("/limited")
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["error"]["code"], "RATE_LIMIT_UNAVAILABLE")
