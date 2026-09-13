import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { ReadinessService } from './readiness.service';

describe('ReadinessService', () => {
  const config = (rateLimitEnabled: boolean) => ({
    get: jest.fn((name: string) => name === 'RATE_LIMIT_ENABLED' ? rateLimitEnabled : undefined),
  }) as unknown as ConfigService;

  it('is ready when PostgreSQL works and Redis is not required', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DataSource;
    const rateLimit = { isRedisAvailable: jest.fn() } as unknown as RateLimitService;
    const service = new ReadinessService(dataSource, config(false), rateLimit);

    await expect(service.check()).resolves.toEqual({
      status: 'ready',
      checks: { database: 'ok', redis: 'disabled' },
    });
    expect(rateLimit.isRedisAvailable).not.toHaveBeenCalled();
  });

  it('returns a structured failure when PostgreSQL is unavailable', async () => {
    const dataSource = { query: jest.fn().mockRejectedValue(new Error('database down')) } as unknown as DataSource;
    const rateLimit = { isRedisAvailable: jest.fn().mockResolvedValue(true) } as unknown as RateLimitService;
    const service = new ReadinessService(dataSource, config(true), rateLimit);

    await expect(service.check()).resolves.toEqual({
      status: 'not_ready',
      checks: { database: 'unavailable', redis: 'ok' },
      error: {
        code: 'SERVICE_NOT_READY',
        message: 'One or more required dependencies are unavailable.',
      },
    });
  });

  it('returns a structured failure when required Redis is unavailable', async () => {
    const dataSource = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } as unknown as DataSource;
    const rateLimit = { isRedisAvailable: jest.fn().mockResolvedValue(false) } as unknown as RateLimitService;
    const service = new ReadinessService(dataSource, config(true), rateLimit);

    await expect(service.check()).resolves.toMatchObject({
      status: 'not_ready',
      checks: { database: 'ok', redis: 'unavailable' },
      error: { code: 'SERVICE_NOT_READY' },
    });
  });
});
