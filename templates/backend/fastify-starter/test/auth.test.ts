import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { EmailSender } from '../src/email.js';
import type { OneTimeTokenKind, SessionRepository, StoredOAuthState, StoredOneTimeToken, StoredSession, StoredUser } from '../src/types.js';

class InMemorySessions implements SessionRepository {
  readonly users = new Map<string, StoredUser>();
  readonly sessions = new Map<string, StoredSession>();
  readonly tokens = new Map<string, StoredOneTimeToken>();
  readonly oauthStates = new Map<string, StoredOAuthState>();

  async createUser(input: { email: string; name: string; passwordHash: string | null; emailVerified?: boolean }): Promise<StoredUser> {
    const user = {
      id: randomUUID(), email: input.email, name: input.name, passwordHash: input.passwordHash,
      emailVerified: input.emailVerified ?? false, isActive: true, createdAt: new Date().toISOString(),
    };
    this.users.set(user.id, user);
    return user;
  }
  async findUserByEmail(email: string) { return [...this.users.values()].find((user) => user.email === email); }
  async findUserById(id: string) { return this.users.get(id); }
  async updateUserPassword(userId: string, passwordHash: string) { const user = this.users.get(userId); if (user) user.passwordHash = passwordHash; }
  async setEmailVerified(userId: string) { const user = this.users.get(userId); if (user) user.emailVerified = true; }
  async createSession(session: StoredSession) { this.sessions.set(session.id, session); }
  async findActiveSessionByAccessHash(accessTokenHash: string) {
    return [...this.sessions.values()].find((session) => session.accessTokenHash === accessTokenHash && !session.revokedAt && session.accessExpiresAt > new Date());
  }
  async findActiveSessionByRefreshHash(refreshTokenHash: string) {
    return [...this.sessions.values()].find((session) => session.refreshTokenHash === refreshTokenHash && !session.revokedAt && session.refreshExpiresAt > new Date());
  }
  async rotateSession(input: {
    previousSessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }) {
    const previous = this.sessions.get(input.previousSessionId);
    if (!previous || previous.revokedAt || previous.refreshExpiresAt <= new Date()) return undefined;
    previous.revokedAt = new Date();
    const next: StoredSession = {
      id: randomUUID(), userId: previous.userId, accessTokenHash: input.accessTokenHash,
      refreshTokenHash: input.refreshTokenHash, accessExpiresAt: input.accessExpiresAt,
      refreshExpiresAt: input.refreshExpiresAt, revokedAt: null,
    };
    this.sessions.set(next.id, next);
    return next;
  }
  async revokeSession(id: string) {
    const session = this.sessions.get(id);
    if (session) session.revokedAt = new Date();
  }
  async revokeSessionsForUser(userId: string) {
    for (const session of this.sessions.values()) if (session.userId === userId && !session.revokedAt) session.revokedAt = new Date();
  }
  async createOneTimeToken(token: StoredOneTimeToken) {
    for (const existing of this.tokens.values()) if (existing.userId === token.userId && existing.kind === token.kind && !existing.usedAt) existing.usedAt = new Date();
    this.tokens.set(token.id, token);
  }
  async consumeOneTimeToken(tokenHash: string, kind: OneTimeTokenKind) {
    const token = [...this.tokens.values()].find((item) => item.tokenHash === tokenHash && item.kind === kind && !item.usedAt && item.expiresAt > new Date());
    if (token) token.usedAt = new Date();
    return token;
  }
  async createOAuthState(state: StoredOAuthState) { this.oauthStates.set(state.id, state); }
  async consumeOAuthState(provider: string, stateHash: string) {
    const state = [...this.oauthStates.values()].find((item) => item.provider === provider && item.stateHash === stateHash && !item.usedAt && item.expiresAt > new Date());
    if (state) state.usedAt = new Date();
    return state;
  }
}

const config: Config = {
  APP_ENV: 'test', NODE_ENV: 'test', environment: 'test', PORT: 3002, DATABASE_URL: 'postgresql://unused', DATABASE_SSL: false, FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000', SECRET_KEY: 'test-secret-that-is-long-enough-for-validation',
  ACCESS_TOKEN_EXPIRE_MINUTES: 15, REFRESH_TOKEN_EXPIRE_DAYS: 30,
  PASSWORD_RESET_EXPIRE_MINUTES: 60, EMAIL_VERIFICATION_EXPIRE_MINUTES: 1_440,
  REFRESH_COOKIE_NAME: 'refresh_token', CSRF_COOKIE_NAME: 'csrf_token',
  COOKIE_SECURE: false, COOKIE_SAME_SITE: 'lax', origins: ['http://localhost:3000'],
  EMAIL_DELIVERY_URL: undefined, EMAIL_DELIVERY_TOKEN: undefined,
  RATE_LIMIT_ENABLED: true, RATE_LIMIT_REQUESTS: 30, RATE_LIMIT_WINDOW_SECONDS: 60, RATE_LIMIT_PREFIX: 'rate-limit', REDIS_URL: undefined,
  TRUST_PROXY_HEADERS: false, TRUSTED_PROXY_IPS: '', trustedProxyIps: [],
  OAUTH_ENABLED: false,
  OAUTH_GOOGLE_CLIENT_ID: undefined, OAUTH_GOOGLE_CLIENT_SECRET: undefined, OAUTH_GOOGLE_AUTHORIZATION_URL: undefined,
  OAUTH_GOOGLE_TOKEN_URL: undefined, OAUTH_GOOGLE_USERINFO_URL: undefined, OAUTH_GOOGLE_REDIRECT_URI: undefined, OAUTH_GOOGLE_SCOPES: undefined,
  OAUTH_GITHUB_CLIENT_ID: undefined, OAUTH_GITHUB_CLIENT_SECRET: undefined, OAUTH_GITHUB_AUTHORIZATION_URL: undefined,
  OAUTH_GITHUB_TOKEN_URL: undefined, OAUTH_GITHUB_USERINFO_URL: undefined, OAUTH_GITHUB_REDIRECT_URI: undefined, OAUTH_GITHUB_SCOPES: undefined,
};

test('rate-limit configuration requires TLS Redis in protected environments and explicit proxies', () => {
  const protectedEnvironment = {
    APP_ENV: 'staging', DATABASE_URL: 'postgresql://db.example.test/app', FRONTEND_URL: 'https://app.example.test',
    CORS_ORIGINS: 'https://app.example.test', SECRET_KEY: 'a'.repeat(32), COOKIE_SECURE: 'true', DATABASE_SSL: 'true',
    EMAIL_DELIVERY_URL: 'https://mail.example.test/send', EMAIL_DELIVERY_TOKEN: 'token',
  };
  assert.throws(() => loadConfig(protectedEnvironment), /TLS REDIS_URL/);
  assert.throws(() => loadConfig({ ...protectedEnvironment, DATABASE_SSL: 'false' }), /DATABASE_SSL/);
  assert.throws(() => loadConfig({ ...protectedEnvironment, REDIS_URL: 'rediss://redis.example.test', TRUST_PROXY_HEADERS: 'true' }), /TRUSTED_PROXY_IPS/);
});

test('rate limiting returns 429 with Retry-After and fails closed in protected environments', async () => {
  const app = await createApp({ config: { ...config, RATE_LIMIT_REQUESTS: 1 }, repository: new InMemorySessions() });
  try {
    const first = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'first@example.com', name: 'First', password: 'password1' } });
    const limited = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'second@example.com', name: 'Second', password: 'password1' } });
    assert.equal(first.statusCode, 201);
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.headers['retry-after'], '60');
    assert.deepEqual(limited.json(), { error: { code: 'RATE_LIMITED', message: 'Too many requests.' } });
  } finally {
    await app.close();
  }

  const protectedApp = await createApp({ config: { ...config, environment: 'staging' }, repository: new InMemorySessions() });
  try {
    const unavailable = await protectedApp.inject({ method: 'POST', url: '/auth/register', payload: { email: 'unavailable@example.com', name: 'Unavailable', password: 'password1' } });
    assert.equal(unavailable.statusCode, 503);
    assert.equal(unavailable.headers['retry-after'], '60');
    assert.deepEqual(unavailable.json(), { error: { code: 'RATE_LIMIT_UNAVAILABLE', message: 'Request limiting is temporarily unavailable.' } });
  } finally {
    await protectedApp.close();
  }
});

class CapturingEmailSender implements EmailSender {
  readonly messages: Array<{ recipient: string; subject: string; text: string }> = [];
  async send(recipient: string, subject: string, text: string): Promise<void> { this.messages.push({ recipient, subject, text }); }
  token(subject: string): string {
    const message = this.messages.find((item) => item.subject === subject);
    assert.ok(message, `Expected a ${subject} email`);
    const token = new URL(message.text.match(/https?:\/\/\S+/)?.[0] ?? '').searchParams.get('token');
    assert.ok(token, 'Expected a token in the email link');
    return token;
  }
}

function cookie(response: { headers: Record<string, unknown> }, name: string): string {
  const values = response.headers['set-cookie'];
  const headers = Array.isArray(values) ? values : [values];
  const value = headers.find((header): header is string => typeof header === 'string' && header.startsWith(`${name}=`));
  assert.ok(value, `Expected ${name} cookie`);
  return value.split(';', 1)[0];
}

function setCookies(response: { headers: Record<string, unknown> }): string {
  const values = response.headers['set-cookie'];
  return (Array.isArray(values) ? values : [values]).filter((value): value is string => typeof value === 'string').join('; ');
}

test('browser session contract returns an in-memory access token but never a refresh token', async () => {
  const app = await createApp({ config, repository: new InMemorySessions() });
  try {
    const registration = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'person@example.com', name: 'Person', password: 'password1' } });
    assert.equal(registration.statusCode, 201);
    assert.deepEqual(Object.keys(registration.json()), ['user']);

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'person@example.com', password: 'password1' } });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(Object.keys(login.json()).sort(), ['accessToken', 'user']);
    assert.equal('refreshToken' in login.json(), false);
    const cookies = setCookies(login);
    assert.doesNotMatch(cookies, /access_token=/);
    assert.match(cookies, /refresh_token=.*Path=\/auth; HttpOnly/);
    assert.match(cookies, /csrf_token=(?!;).*Path=\//);

    const refresh = cookie(login, 'refresh_token');
    const csrf = cookie(login, 'csrf_token');
    const me = await app.inject({ method: 'GET', url: '/users/me', headers: { authorization: `Bearer ${login.json().accessToken}` } });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.email, 'person@example.com');

    const rejectedRefresh = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: `${refresh}; ${csrf}` } });
    assert.equal(rejectedRefresh.statusCode, 403);
    assert.deepEqual(rejectedRefresh.json(), {
      error: { code: 'INVALID_CSRF_TOKEN', message: 'CSRF token is missing or invalid.' },
    });
    const refreshed = await app.inject({ method: 'POST', url: '/auth/refresh', headers: { cookie: `${refresh}; ${csrf}`, 'x-csrf-token': csrf.split('=', 2)[1] } });
    assert.equal(refreshed.statusCode, 200);
    assert.deepEqual(Object.keys(refreshed.json()).sort(), ['accessToken', 'user']);
    assert.equal('refreshToken' in refreshed.json(), false);
  } finally {
    await app.close();
  }
});

test('password recovery and email verification use opaque, single-use tokens', async () => {
  const repository = new InMemorySessions();
  const emailSender = new CapturingEmailSender();
  const app = await createApp({ config, repository, emailSender });
  try {
    const registration = await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'person@example.com', name: 'Person', password: 'password1' } });
    assert.equal(registration.statusCode, 201);
    assert.equal('token' in registration.json(), false);

    const verificationToken = emailSender.token('Verify your email');
    const verification = await app.inject({ method: 'POST', url: '/auth/email/verify', payload: { token: verificationToken } });
    assert.equal(verification.statusCode, 204);
    const verificationReuse = await app.inject({ method: 'POST', url: '/auth/email/verify', payload: { token: verificationToken } });
    assert.deepEqual(verificationReuse.json(), { error: { code: 'INVALID_VERIFICATION_TOKEN', message: 'Verification token is invalid or expired.' } });

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'person@example.com', password: 'password1' } });
    assert.equal(login.json().user.emailVerified, true);
    const resetKnown = await app.inject({ method: 'POST', url: '/auth/password/reset/request', payload: { email: 'person@example.com' } });
    const resetUnknown = await app.inject({ method: 'POST', url: '/auth/password/reset/request', payload: { email: 'unknown@example.com' } });
    assert.equal(resetKnown.statusCode, 204);
    assert.equal(resetUnknown.statusCode, 204);
    const resetToken = emailSender.token('Reset your password');
    const reset = await app.inject({ method: 'POST', url: '/auth/password/reset/confirm', payload: { token: resetToken, newPassword: 'changed2' } });
    assert.equal(reset.statusCode, 204);
    const revokedSession = await app.inject({ method: 'GET', url: '/users/me', headers: { authorization: `Bearer ${login.json().accessToken}` } });
    assert.equal(revokedSession.statusCode, 401);
    const oldPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'person@example.com', password: 'password1' } });
    assert.equal(oldPassword.statusCode, 401);
    const newPassword = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'person@example.com', password: 'changed2' } });
    assert.equal(newPassword.statusCode, 200);
  } finally {
    await app.close();
  }
});

test('OAuth publishes configured providers and protects PKCE state from reuse', async () => {
  const repository = new InMemorySessions();
  const oauthConfig: Config = {
    ...config,
    OAUTH_ENABLED: true,
    OAUTH_GOOGLE_CLIENT_ID: 'google-client',
    OAUTH_GOOGLE_CLIENT_SECRET: 'google-secret',
    OAUTH_GOOGLE_REDIRECT_URI: 'http://localhost:3002/auth/oauth/google/callback',
  };
  const app = await createApp({ config: oauthConfig, repository });
  try {
    const providers = await app.inject({ method: 'GET', url: '/auth/oauth/providers' });
    assert.deepEqual(providers.json(), [{ provider: 'google', configured: true }, { provider: 'github', configured: false }]);
    const start = await app.inject({ method: 'GET', url: '/auth/oauth/google' });
    assert.equal(start.statusCode, 200);
    const url = new URL(start.json().authorizationUrl);
    assert.equal(url.origin, 'https://accounts.google.com');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(url.searchParams.get('state'));
    const invalidCallback = await app.inject({ method: 'GET', url: '/auth/oauth/google/callback?code=code&state=invalid' });
    assert.deepEqual(invalidCallback.json(), { error: { code: 'OAUTH_STATE_INVALID', message: 'OAuth state is invalid or expired.' } });
    const unavailable = await app.inject({ method: 'GET', url: '/auth/oauth/github' });
    assert.deepEqual(unavailable.json(), { error: { code: 'OAUTH_PROVIDER_UNAVAILABLE', message: 'This OAuth provider is not configured.' } });
  } finally {
    await app.close();
  }
});
