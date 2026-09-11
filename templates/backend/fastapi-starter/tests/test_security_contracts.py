import unittest
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
