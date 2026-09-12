import unittest

from src.core.config import Settings


class InfrastructureContractTests(unittest.TestCase):
    def test_requires_asyncpg_for_runtime_connections(self):
        with self.assertRaisesRegex(RuntimeError, "postgresql\\+asyncpg"):
            Settings(database_url="postgresql://postgres:postgres@localhost/app").validate()

    def test_requires_explicit_trusted_proxies(self):
        with self.assertRaisesRegex(RuntimeError, "TRUSTED_PROXY_IPS"):
            Settings(trust_proxy_headers=True).validate()

        with self.assertRaisesRegex(RuntimeError, "not allowed"):
            Settings(trust_proxy_headers=True, trusted_proxy_ips_raw="*").validate()
