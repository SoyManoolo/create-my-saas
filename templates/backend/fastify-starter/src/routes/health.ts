import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { RateLimiter } from '../rate-limit.js';

type HealthRouteDependencies = {
  config: Config;
  databaseReady: () => Promise<void>;
  redisReady?: () => Promise<boolean>;
  rateLimiter: RateLimiter;
};

async function probe(check: () => Promise<unknown>): Promise<'ok' | 'unavailable'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Readiness timeout')), 500);
      }),
    ]);
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function registerHealthRoutes(app: FastifyInstance, dependencies: HealthRouteDependencies): void {
  const { config, databaseReady, redisReady, rateLimiter } = dependencies;

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/ready', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      probe(databaseReady),
      config.RATE_LIMIT_ENABLED
        ? probe(async () => {
          const available = redisReady ? await redisReady() : await rateLimiter.isRedisAvailable(500);
          if (!available) throw new Error('Redis unavailable');
        })
        : Promise.resolve<'disabled'>('disabled'),
    ]);
    const checks = { database, redis };
    if (database === 'unavailable' || redis === 'unavailable') {
      return reply.code(503).send({
        status: 'not_ready',
        checks,
        error: {
          code: 'SERVICE_NOT_READY',
          message: 'One or more required dependencies are unavailable.',
        },
      });
    }
    return reply.send({ status: 'ready', checks });
  });
}
