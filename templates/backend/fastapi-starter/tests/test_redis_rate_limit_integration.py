import os
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import FastAPI

from src.core import middleware as middleware_module
from src.core.config.settings import Settings
from src.core.middleware import RateLimitMiddleware


REDIS_URL = os.getenv("REDIS_URL")
RUN_INTEGRATION = os.getenv("REDIS_INTEGRATION_TESTS") == "1" and REDIS_URL


@unittest.skipUnless(RUN_INTEGRATION, "requires REDIS_INTEGRATION_TESTS=1 and REDIS_URL")
class RedisRateLimitIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.settings_patch = patch.object(
            middleware_module,
            "settings",
            Settings(
                rate_limit_enabled=True,
                redis_url=REDIS_URL,
                rate_limit_prefix=f"integration:{uuid4()}",
            ),
        )
        self.settings_patch.start()
        self.first = RateLimitMiddleware(FastAPI())
        self.second = RateLimitMiddleware(FastAPI())

    async def asyncTearDown(self):
        await self.first.close()
        await self.second.close()
        self.settings_patch.stop()

    async def test_counter_is_shared_and_reconnects_after_a_controlled_close(self):
        self.assertEqual(await self.first._is_redis_rate_limited("shared-key", 3_600), 1)
        self.assertEqual(await self.second._is_redis_rate_limited("shared-key", 3_600), 2)
        self.assertEqual(await self.first._is_redis_rate_limited("shared-key", 3_600), 3)

        await self.first.close()
        self.assertEqual(await self.first._is_redis_rate_limited("reconnected-key", 3_600), 1)
