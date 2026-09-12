import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { EmailDeliveryError, SecureEmailSender, type EmailSender } from './email.js';
import type { OneTimeTokenKind, PublicUser, SessionRepository, StoredSession, StoredUser } from './types.js';

const registerBody = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(256).refine((password) => /[a-zA-Z]/.test(password) && /\d/.test(password), {
    message: 'Password must contain at least one letter and one number.',
  }),
});
const loginBody = registerBody.pick({ email: true, password: true });
const resetRequestBody = z.object({ email: z.string().email().max(320) });
const resetConfirmBody = z.object({
  token: z.string().min(20).max(512),
  newPassword: registerBody.shape.password,
});
const tokenBody = z.object({ token: z.string().min(20).max(512) });
const oauthCallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });

type AppDependencies = { config: Config; repository: SessionRepository; emailSender?: EmailSender };
type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUri: string;
  scopes: string;
};

const oauthDefaults = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid email profile',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
  },
} as const;

class AppError extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function opaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

function oauthConfig(config: Config, provider: string): OAuthProviderConfig | undefined {
  if (!config.OAUTH_ENABLED || !(provider in oauthDefaults)) return undefined;
  const key = provider.toUpperCase() as 'GOOGLE' | 'GITHUB';
  const defaults = oauthDefaults[provider as keyof typeof oauthDefaults];
  const clientId = config[`OAUTH_${key}_CLIENT_ID`];
  const clientSecret = config[`OAUTH_${key}_CLIENT_SECRET`];
  const redirectUri = config[`OAUTH_${key}_REDIRECT_URI`];
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizationUrl: config[`OAUTH_${key}_AUTHORIZATION_URL`] ?? defaults.authorizationUrl,
    tokenUrl: config[`OAUTH_${key}_TOKEN_URL`] ?? defaults.tokenUrl,
    userInfoUrl: config[`OAUTH_${key}_USERINFO_URL`] ?? defaults.userInfoUrl,
    scopes: config[`OAUTH_${key}_SCOPES`] ?? defaults.scopes,
  };
}

function authorizationUrl(config: OAuthProviderConfig, state: string, verifier: string): string {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function oauthJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.');
  }
  if (!response.ok) throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.');
  try {
    return await response.json();
  } catch {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider returned an invalid response.');
  }
}

async function exchangeOAuthProfile(provider: string, code: string, verifier: string, config: OAuthProviderConfig): Promise<{ email: string; name: string }> {
  const token = await oauthJson(config.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: verifier }),
  }) as Record<string, unknown>;
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider did not return an access token.');
  }
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'User-Agent': 'create-my-saas' };
  const profile = await oauthJson(config.userInfoUrl, { headers }) as Record<string, unknown>;
  if (provider === 'github' && !profile.email) {
    const emails = await oauthJson('https://api.github.com/user/emails', { headers });
    if (Array.isArray(emails)) {
      profile.email = (emails as Array<Record<string, unknown>>).find((entry) => entry.primary === true && entry.verified === true)?.email;
    }
  }
  const verified = provider === 'google' ? profile.email_verified === true : Boolean(profile.email);
  if (typeof profile.email !== 'string' || !profile.email || !verified) {
    throw new AppError(400, 'OAUTH_EMAIL_UNVERIFIED', 'The OAuth provider did not provide a verified email address.');
  }
  return { email: profile.email.toLowerCase(), name: String(profile.name ?? profile.login ?? profile.email.split('@')[0]).slice(0, 120) };
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

export async function createApp({ config, repository, emailSender = new SecureEmailSender(config) }: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });
  await app.register(cookie);
  await app.register(cors, {
    credentials: true,
    origin: config.origins,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token'],
  });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return sendError(reply, error.statusCode, error.code, error.message);
    if (error instanceof EmailDeliveryError) return sendError(reply, 503, 'EMAIL_DELIVERY_UNAVAILABLE', 'Secure email delivery is unavailable.');
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

  async function currentUser(request: FastifyRequest, reply: FastifyReply): Promise<StoredUser | undefined> {
    const authorization = request.headers.authorization ?? '';
    const accessToken = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!accessToken) {
      unauthorized(reply);
      return undefined;
    }
    const session = await repository.findActiveSessionByAccessHash(hash(accessToken));
    if (!session) {
      unauthorized(reply);
      return undefined;
    }
    const user = await repository.findUserById(session.userId);
    if (!user || !user.isActive) {
      unauthorized(reply);
      return undefined;
    }
    return user;
  }

  async function sendOneTimeToken(user: StoredUser, kind: OneTimeTokenKind): Promise<void> {
    const rawToken = opaqueToken();
    await repository.createOneTimeToken({
      id: randomUUID(), userId: user.id, kind, tokenHash: hash(rawToken),
      expiresAt: new Date(Date.now() + (kind === 'password_reset' ? config.PASSWORD_RESET_EXPIRE_MINUTES : config.EMAIL_VERIFICATION_EXPIRE_MINUTES) * 60_000),
      usedAt: null,
    });
    const reset = kind === 'password_reset';
    const link = `${config.FRONTEND_URL.replace(/\/$/, '')}${reset ? '/reset-password' : '/verify-email'}?token=${encodeURIComponent(rawToken)}`;
    await emailSender.send(user.email, reset ? 'Reset your password' : 'Verify your email', `Use this one-time link: ${link}`);
  }

  async function createOAuthStart(provider: string): Promise<{ authorizationUrl: string }> {
    const providerConfig = oauthConfig(config, provider);
    if (!providerConfig) throw new AppError(404, 'OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.');
    const state = opaqueToken();
    const verifier = opaqueToken();
    await repository.createOAuthState({
      id: randomUUID(), provider, stateHash: hash(state), codeVerifier: verifier,
      expiresAt: new Date(Date.now() + 10 * 60_000), usedAt: null,
    });
    return { authorizationUrl: authorizationUrl(providerConfig, state, verifier) };
  }

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/auth/register', async (request, reply) => {
    const body = registerBody.parse(request.body);
    const email = body.email.toLowerCase();
    if (await repository.findUserByEmail(email)) {
      return sendError(reply, 409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    const user = await repository.createUser({ email, name: body.name, passwordHash: await argon2.hash(body.password, { type: argon2.argon2id }) });
    await sendOneTimeToken(user, 'email_verification');
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const user = await repository.findUserByEmail(body.email.toLowerCase());
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, body.password))) {
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
    if (!user || !user.isActive) return unauthorized(reply, 'INVALID_REFRESH_TOKEN');
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
    const user = await currentUser(request, reply);
    if (!user) return reply;
    return reply.send({ user: toPublicUser(user) });
  });

  app.post('/auth/password/reset/request', async (request, reply) => {
    const body = resetRequestBody.parse(request.body);
    const user = await repository.findUserByEmail(body.email.toLowerCase());
    if (user?.isActive) {
      try {
        await sendOneTimeToken(user, 'password_reset');
      } catch (error) {
        if (!(error instanceof EmailDeliveryError)) throw error;
      }
    }
    return reply.code(204).send();
  });

  app.post('/auth/password/reset/confirm', async (request, reply) => {
    const body = resetConfirmBody.parse(request.body);
    const record = await repository.consumeOneTimeToken(hash(body.token), 'password_reset');
    const user = record && await repository.findUserById(record.userId);
    if (!user?.isActive) return sendError(reply, 400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired.');
    await repository.updateUserPassword(user.id, await argon2.hash(body.newPassword, { type: argon2.argon2id }));
    await repository.revokeSessionsForUser(user.id);
    return reply.code(204).send();
  });

  app.post('/auth/email/verify', async (request, reply) => {
    const body = tokenBody.parse(request.body);
    const record = await repository.consumeOneTimeToken(hash(body.token), 'email_verification');
    if (!record) return sendError(reply, 400, 'INVALID_VERIFICATION_TOKEN', 'Verification token is invalid or expired.');
    await repository.setEmailVerified(record.userId);
    return reply.code(204).send();
  });

  app.post('/auth/email/resend', async (request, reply) => {
    const user = await currentUser(request, reply);
    if (!user) return reply;
    if (!user.emailVerified) await sendOneTimeToken(user, 'email_verification');
    return reply.code(204).send();
  });

  app.get('/auth/oauth/providers', async () => ['google', 'github'].map((provider) => ({ provider, configured: Boolean(oauthConfig(config, provider)) })));

  app.get('/auth/oauth/:provider', async (request) => createOAuthStart((request.params as { provider: string }).provider));

  app.get('/auth/oauth/:provider/start', async (request, reply) => {
    const start = await createOAuthStart((request.params as { provider: string }).provider);
    return reply.redirect(start.authorizationUrl);
  });

  app.get('/auth/oauth/:provider/callback', async (request, reply) => {
    const provider = (request.params as { provider: string }).provider;
    const providerConfig = oauthConfig(config, provider);
    if (!providerConfig) throw new AppError(404, 'OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.');
    const query = oauthCallbackQuery.parse(request.query);
    const state = await repository.consumeOAuthState(provider, hash(query.state));
    if (!state) throw new AppError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired.');
    const profile = await exchangeOAuthProfile(provider, query.code, state.codeVerifier, providerConfig);
    let user = await repository.findUserByEmail(profile.email);
    if (!user) user = await repository.createUser({ email: profile.email, name: profile.name, passwordHash: null, emailVerified: true });
    if (!user.isActive) throw new AppError(403, 'USER_INACTIVE', 'The user account is inactive.');
    if (!user.emailVerified) {
      await repository.setEmailVerified(user.id);
      user = { ...user, emailVerified: true };
    }
    const session = await issueSession(user);
    setSessionCookies(reply, session.refreshToken);
    return reply.code(303).redirect(`${config.FRONTEND_URL.replace(/\/$/, '')}/auth/oauth/callback`);
  });

  return app;
}
