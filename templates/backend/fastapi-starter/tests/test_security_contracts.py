import unittest
from modules.auth.security.tokens import decode_access_token, encode_access_token, token_hash
from modules.users.schemas import UserRegister


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
