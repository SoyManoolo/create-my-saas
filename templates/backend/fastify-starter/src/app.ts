import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import type { PublicUser, SessionRepository, StoredSession, StoredUser } from './types.js';

const registerBody = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(256).refine((password) => /[a-zA-Z]/.test(password) && /\d/.test(password), {
    message: 'Password must contain at least one letter and one number.',
  }),
});
const loginBody = registerBody.pick({ email: true, password: true });

type AppDependencies = { config: Config; repository: SessionRepository };

function toPublicUser(user: StoredUser): PublicUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

function sendError(reply: FastifyReply, statusCode: number, code: string, message: string) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function unauthorized(reply: FastifyReply, code = 'UNAUTHORIZED') {
  return sendError(reply, 401, code, 'Authentication is required.');
}

function requireCsrf(request: FastifyRequest, reply: FastifyReply, config: Config): boolean {
  const cookieValue = request.cookies[config.CSRF_COOKIE_NAME] ?? '';
  const headerValue = request.headers['x-csrf-token'];
  const supplied = typeof headerValue === 'string' ? headerValue : '';
  if (!cookieValue || cookieValue.length !== supplied.length || !timingSafeEqual(Buffer.from(cookieValue), Buffer.from(supplied))) {
    sendError(reply, 403, 'INVALID_CSRF_TOKEN', 'CSRF token is missing or invalid.');
    return false;
  }
  return true;
}

export async function createApp({ config, repository }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: config.origins,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError) {
      return sendError(reply, 400, 'VALIDATION_ERROR', 'The request body is invalid.');
    }
    if ((error as { code?: string }).code === '23505') {
      return sendError(reply, 409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    app.log.error(error);
    return sendError(reply, 500, 'INTERNAL_ERROR', 'An unexpected error occurred.');
  });

  const cookieOptions = (httpOnly: boolean, path: string, maxAge: number) => ({
    httpOnly,
    secure: config.COOKIE_SECURE,
    sameSite: config.COOKIE_SAME_SITE,
    path,
    maxAge,
  } as const);
  const accessMaxAge = config.ACCESS_TOKEN_EXPIRE_MINUTES * 60;
  const refreshMaxAge = config.REFRESH_TOKEN_EXPIRE_DAYS * 86_400;

  function setSessionCookies(reply: FastifyReply, refreshToken: string) {
    reply.setCookie(config.REFRESH_COOKIE_NAME, refreshToken, cookieOptions(true, '/auth', refreshMaxAge));
    reply.setCookie(config.CSRF_COOKIE_NAME, opaqueToken(), cookieOptions(false, '/', refreshMaxAge));
  }

  async function issueSession(user: StoredUser): Promise<{ accessToken: string; refreshToken: string; session: StoredSession }> {
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const session: StoredSession = {
      id: randomUUID(),
      userId: user.id,
      accessTokenHash: hash(accessToken),
      refreshTokenHash: hash(refreshToken),
      accessExpiresAt: new Date(Date.now() + accessMaxAge * 1_000),
      refreshExpiresAt: new Date(Date.now() + refreshMaxAge * 1_000),
      revokedAt: null,
    };
    await repository.createSession(session);
    return { accessToken, refreshToken, session };
  }

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/register', async (request, reply) => {
    const body = registerBody.parse(request.body);
    const email = body.email.toLowerCase();
    if (await repository.findUserByEmail(email)) {
      return sendError(reply, 409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    const user = await repository.createUser({ email, name: body.name, passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }) });
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await repository.findUserByEmail(body.email.toLowerCase());
    if (!user || !(await argon2.verify(user.passwordHash, body.password))) {
      return sendError(reply, 401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
    const session = await issueSession(user);
    setSessionCookies(reply, session.refreshToken);
    return reply.send({ accessToken: session.accessToken, user: toPublicUser(user) });
  });

  app.post('/auth/refresh', async (request, reply) => {
    if (!requireCsrf(request, reply, config)) return reply;
    const previousToken = request.cookies[config.REFRESH_COOKIE_NAME];
    if (!previousToken) return unauthorized(reply, 'INVALID_REFRESH_TOKEN');
    const previous = await repository.findActiveSessionByRefreshHash(hash(previousToken));
    if (!previous) return unauthorized(reply, 'INVALID_REFRESH_TOKEN');
    const user = await repository.findUserById(previous.userId);
    if (!user) return unauthorized(reply, 'INVALID_REFRESH_TOKEN');
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const rotated = await repository.rotateSession({
      previousSessionId: previous.id,
      accessTokenHash: hash(accessToken),
      refreshTokenHash: hash(refreshToken),
      accessExpiresAt: new Date(Date.now() + accessMaxAge * 1_000),
      refreshExpiresAt: new Date(Date.now() + refreshMaxAge * 1_000),
    });
    if (!rotated) return unauthorized(reply, 'REFRESH_TOKEN_REUSED');
    setSessionCookies(reply, refreshToken);
    return reply.send({ accessToken, user: toPublicUser(user) });
  });

  app.post('/auth/logout', async (request, reply) => {
    if (!requireCsrf(request, reply, config)) return reply;
    const refreshToken = request.cookies[config.REFRESH_COOKIE_NAME];
    if (refreshToken) {
      const session = await repository.findActiveSessionByRefreshHash(hash(refreshToken));
      if (session) await repository.revokeSession(session.id);
    }
    reply.clearCookie(config.REFRESH_COOKIE_NAME, { path: '/auth' });
    reply.clearCookie(config.CSRF_COOKIE_NAME, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/users/me', async (request, reply) => {
    const authorization = request.headers.authorization ?? '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!accessToken) return unauthorized(reply);
    const session = await repository.findActiveSessionByAccessHash(hash(accessToken));
    if (!session) return unauthorized(reply);
    const user = await repository.findUserById(session.userId);
    if (!user) return unauthorized(reply);
    return reply.send({ user: toPublicUser(user) });
  });

  return app;
}
