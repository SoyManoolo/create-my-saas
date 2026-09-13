import unittest
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from main import app
from src.core import readiness as readiness_module
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

    def test_liveness_does_not_probe_external_dependencies(self):
        with patch("main.readiness_checks", new=AsyncMock(side_effect=AssertionError("must not run"))):
            response = TestClient(app).get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})

    def test_readiness_reports_required_dependencies(self):
        with patch("main.readiness_checks", new=AsyncMock(return_value={"database": "ok", "redis": "disabled"})):
            response = TestClient(app).get("/ready")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ready", "checks": {"database": "ok", "redis": "disabled"}})

    def test_readiness_returns_structured_503(self):
        checks = {"database": "unavailable", "redis": "ok"}
        with patch("main.readiness_checks", new=AsyncMock(return_value=checks)):
            response = TestClient(app).get("/ready")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {
            "status": "not_ready",
            "checks": checks,
            "error": {
                "code": "SERVICE_NOT_READY",
                "message": "One or more required dependencies are unavailable.",
            },
        })


class DependencyProbeTests(unittest.IsolatedAsyncioTestCase):
    async def test_checks_postgresql_and_required_redis(self):
        with (
            patch.object(readiness_module, "settings", Settings(rate_limit_enabled=True, redis_url="redis://unused")),
            patch.object(readiness_module, "_database_ready", new=AsyncMock()),
            patch.object(readiness_module, "_redis_ready", new=AsyncMock()),
        ):
            checks = await readiness_module.readiness_checks()

        self.assertEqual(checks, {"database": "ok", "redis": "ok"})

    async def test_marks_failed_and_timed_out_dependencies_unavailable(self):
        async def slow_check():
            await readiness_module.asyncio.sleep(0.05)

        with patch.object(readiness_module, "READINESS_TIMEOUT_SECONDS", 0.001):
            self.assertEqual(await readiness_module._probe(slow_check), "unavailable")

        with (
            patch.object(readiness_module, "settings", Settings(rate_limit_enabled=False)),
            patch.object(readiness_module, "_database_ready", new=AsyncMock(side_effect=RuntimeError("database down"))),
            patch.object(readiness_module, "_redis_ready", new=AsyncMock()) as redis_check,
        ):
            checks = await readiness_module.readiness_checks()

        self.assertEqual(checks, {"database": "unavailable", "redis": "disabled"})
        redis_check.assert_not_awaited()
