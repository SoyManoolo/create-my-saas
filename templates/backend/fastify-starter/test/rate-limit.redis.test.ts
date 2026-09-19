import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { Config } from '../src/config.js';
import { RateLimiter } from '../src/rate-limit.js';

const redisUrl = process.env.REDIS_URL;
const integration = process.env.REDIS_INTEGRATION_TESTS === '1' && redisUrl ? test : test.skip;

function config(prefix: string): Config {
  return {
    APP_ENV: 'test', NODE_ENV: 'test', environment: 'test', PORT: 3002, DATABASE_URL: 'postgresql://unused', DATABASE_SSL: false, FRONTEND_URL: 'http://localhost:3000', CORS_ORIGINS: 'http://localhost:3000', SECRET_KEY: 'test-secret-that-is-long-enough-for-validation', ACCESS_TOKEN_EXPIRE_MINUTES: 15, REFRESH_TOKEN_EXPIRE_DAYS: 30, PASSWORD_RESET_EXPIRE_MINUTES: 60, EMAIL_VERIFICATION_EXPIRE_MINUTES: 1_440, REFRESH_COOKIE_NAME: 'refresh_token', CSRF_COOKIE_NAME: 'csrf_token', COOKIE_SECURE: false, COOKIE_SAME_SITE: 'lax', origins: ['http://localhost:3000'], EMAIL_DELIVERY_URL: undefined, EMAIL_DELIVERY_TOKEN: undefined, RATE_LIMIT_ENABLED: true, RATE_LIMIT_REQUESTS: 30, RATE_LIMIT_WINDOW_SECONDS: 60, AUTH_RATE_LIMIT_REQUESTS: 5, AUTH_RATE_LIMIT_WINDOW_SECONDS: 60, RATE_LIMIT_PREFIX: prefix, REDIS_URL: redisUrl, TRUST_PROXY_HEADERS: false, TRUSTED_PROXY_IPS: '', trustedProxyIps: [], OAUTH_ENABLED: false, OAUTH_GOOGLE_CLIENT_ID: undefined, OAUTH_GOOGLE_CLIENT_SECRET: undefined, OAUTH_GOOGLE_AUTHORIZATION_URL: undefined, OAUTH_GOOGLE_TOKEN_URL: undefined, OAUTH_GOOGLE_USERINFO_URL: undefined, OAUTH_GOOGLE_REDIRECT_URI: undefined, OAUTH_GOOGLE_SCOPES: undefined, OAUTH_GITHUB_CLIENT_ID: undefined, OAUTH_GITHUB_CLIENT_SECRET: undefined, OAUTH_GITHUB_AUTHORIZATION_URL: undefined, OAUTH_GITHUB_TOKEN_URL: undefined, OAUTH_GITHUB_USERINFO_URL: undefined, OAUTH_GITHUB_REDIRECT_URI: undefined, OAUTH_GITHUB_SCOPES: undefined,
  };
}

integration('Redis rate limits are shared by instances and reconnect after a controlled close', async () => {
  const prefix = `integration:${randomUUID()}`;
  const first = new RateLimiter(config(prefix));
  const second = new RateLimiter(config(prefix));
  try {
    assert.equal(await first.consume('shared-key', { limit: 2, windowSeconds: 5 }), 'allowed');
    assert.equal(await second.consume('shared-key', { limit: 2, windowSeconds: 5 }), 'allowed');
    assert.equal(await first.consume('shared-key', { limit: 2, windowSeconds: 5 }), 'limited');
    await first.close();
    assert.equal(await first.consume('reconnected-key', { limit: 1, windowSeconds: 5 }), 'allowed');
    assert.equal(await first.isRedisAvailable(), true);
  } finally {
    await Promise.all([first.close(), second.close()]);
  }
});
