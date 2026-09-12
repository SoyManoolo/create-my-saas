import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { SessionRepository, StoredSession, StoredUser } from '../src/types.js';

class InMemorySessions implements SessionRepository {
  readonly users = new Map<string, StoredUser>();
  readonly sessions = new Map<string, StoredSession>();

  async createUser(input: { email: string; name: string; passwordHash: string }): Promise<StoredUser> {
    const user = { id: randomUUID(), email: input.email, name: input.name, passwordHash: input.passwordHash, createdAt: new Date().toISOString() };
    this.users.set(user.id, user);
    return user;
  }
  async findUserByEmail(email: string) { return [...this.users.values()].find((user) => user.email === email); }
  async findUserById(id: string) { return this.users.get(id); }
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
}

const config: Config = {
  NODE_ENV: 'test', PORT: 3002, DATABASE_URL: 'postgresql://unused', FRONTEND_URL: 'http://localhost:3000',
  CORS_ORIGINS: 'http://localhost:3000', SECRET_KEY: 'test-secret-that-is-long-enough-for-validation',
  ACCESS_TOKEN_EXPIRE_MINUTES: 15, REFRESH_TOKEN_EXPIRE_DAYS: 30,
  REFRESH_COOKIE_NAME: 'refresh_token', CSRF_COOKIE_NAME: 'csrf_token',
  COOKIE_SECURE: false, COOKIE_SAME_SITE: 'lax', origins: ['http://localhost:3000'],
};

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
