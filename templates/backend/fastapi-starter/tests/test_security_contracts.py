import unittest
from fastapi.testclient import TestClient
from main import app
from src.modules.auth.security.tokens import decode_access_token, encode_access_token, token_hash
from src.modules.users.schemas import UserRegister


class SecurityContractTests(unittest.TestCase):
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
