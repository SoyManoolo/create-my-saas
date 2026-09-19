import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { RateLimitService } from './rate-limit.service';

const integration = process.env.REDIS_INTEGRATION_TESTS === '1' && process.env.REDIS_URL ? describe : describe.skip;

function service(prefix: string): RateLimitService {
  return new RateLimitService(new ConfigService({
    NODE_ENV: 'test', RATE_LIMIT_ENABLED: true, RATE_LIMIT_REQUESTS: 30,
    RATE_LIMIT_WINDOW_SECONDS: 60, RATE_LIMIT_PREFIX: prefix, REDIS_URL: process.env.REDIS_URL,
  }));
}

integration('Redis rate limits are shared by instances and reconnect after a controlled close', () => {
  it('uses one counter across services and reconnects on the next request', async () => {
    const prefix = `integration:${randomUUID()}`;
    const first = service(prefix);
    const second = service(prefix);
    try {
      await expect(first.isRedisAvailable(2_000)).resolves.toBe(true);
      await expect(second.isRedisAvailable(2_000)).resolves.toBe(true);
      await expect(first.consume('shared-key', 2, 3_600)).resolves.toBe('allowed');
      await expect(second.consume('shared-key', 2, 3_600)).resolves.toBe('allowed');
      await expect(first.consume('shared-key', 2, 3_600)).resolves.toBe('limited');
      await first.onModuleDestroy();
      await expect(first.consume('reconnected-key', 1, 3_600)).resolves.toBe('allowed');
      await expect(first.isRedisAvailable()).resolves.toBe(true);
    } finally {
      await Promise.all([first.onModuleDestroy(), second.onModuleDestroy()]);
    }
  });
});
