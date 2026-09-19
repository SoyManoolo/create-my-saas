import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth/service.js';
import type { Config } from './config.js';
import { EmailDeliveryError, SecureEmailSender, type EmailSender } from './email.js';
import { AppError, sendError } from './http/errors.js';
import { RateLimiter } from './rate-limit.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerUserRoutes } from './routes/users.js';
import type { SessionRepository } from './types.js';

type AppDependencies = {
  config: Config;
  repository: SessionRepository;
  databaseReady: () => Promise<void>;
  redisReady?: () => Promise<boolean>;
  emailSender?: EmailSender;
};

const sensitiveAuthBuckets = new Map([
  ['POST:/auth/register', 'auth:register'],
  ['POST:/auth/login', 'auth:login'],
  ['POST:/auth/password/reset/request', 'auth:password-reset-request'],
  ['POST:/auth/password/reset/confirm', 'auth:password-reset-confirm'],
]);

export async function createApp({
  config,
  repository,
  databaseReady,
  redisReady,
  emailSender = new SecureEmailSender(config),
}: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.environment !== 'test',
    trustProxy: config.TRUST_PROXY_HEADERS ? config.trustedProxyIps : false,
  });
  const rateLimiter = new RateLimiter(config);
  app.addHook('onClose', async () => rateLimiter.close());
  const auth = new AuthService(config, repository, emailSender);

  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: config.origins,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return sendError(reply, error.statusCode, error.code, error.message);
    if (error instanceof EmailDeliveryError) return sendError(reply, 503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Secure email delivery is unavailable.');
    if (error instanceof z.ZodError) return sendError(reply, 400, 'VALIDATION_ERROR', 'The request body is invalid.');
    if ((error as { code?: string }).code === '23505') {
      return sendError(reply, 409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    app.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });

  app.addHook('onRequest', async (request, reply) => {
    if (['/health', '/ready'].includes(request.url.split('?', 1)[0])) return;
    const path = request.routeOptions.url ?? request.url.split('?', 1)[0];
    const authBucket = sensitiveAuthBuckets.get(`${request.method}:${path}`);
    const bucket = authBucket ?? `route:${request.method}:${path}`;
    const policy = authBucket
      ? { limit: config.AUTH_RATE_LIMIT_REQUESTS, windowSeconds: config.AUTH_RATE_LIMIT_WINDOW_SECONDS }
      : { limit: config.RATE_LIMIT_REQUESTS, windowSeconds: config.RATE_LIMIT_WINDOW_SECONDS };
    const result = await rateLimiter.consume(`${bucket}:${request.ip}`, policy);
    if (result === 'limited') {
      return sendError(reply.header('Retry-After', String(policy.windowSeconds)), 429, 'RATE_LIMITED', 'Too many requests.');
    }
    if (result === 'unavailable') {
      return sendError(reply.header('Retry-After', '60'), 503, 'RATE_LIMIT_UNAVAILABLE', 'Request limiting is temporarily unavailable.');
    }
  });

  registerHealthRoutes(app, { config, databaseReady, redisReady, rateLimiter });
  registerAuthRoutes(app, { auth, config });
  registerUserRoutes(app, auth);

  return app;
}
