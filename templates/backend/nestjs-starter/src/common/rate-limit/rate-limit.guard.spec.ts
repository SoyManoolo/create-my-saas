import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

function context() {
  const response = { setHeader: jest.fn() };
  return {
    response,
    execution: {
      switchToHttp: () => ({ getRequest: () => ({ method: 'POST', path: '/auth/login', ip: '127.0.0.1', route: { path: '/auth/login' } }), getResponse: () => response }),
      getHandler: () => ({}),
    },
  };
}

describe('RateLimitGuard', () => {
  it('maps unavailable Redis to a retryable 503 instead of a 429', async () => {
    const rateLimit = { consume: jest.fn().mockResolvedValue('unavailable') } as unknown as RateLimitService;
    const config = { get: jest.fn((key: string, fallback: number) => key.includes('AUTH') ? 5 : fallback) };
    const reflector = { get: jest.fn().mockReturnValue('login') };
    const guard = new RateLimitGuard(rateLimit, config as never, reflector as never);
    const request = context();

    await expect(guard.canActivate(request.execution as never)).rejects.toMatchObject({ code: 'RATE_LIMIT_UNAVAILABLE', statusCode: 503 });
    expect(request.response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });
});
