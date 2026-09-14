import { z } from 'zod';

const environmentName = z.enum(['development', 'test', 'staging', 'production']);
const environmentBoolean = (defaultValue: 'true' | 'false' = 'false') => z.enum(['true', 'false', '1', '0']).default(defaultValue).transform((value) => value === 'true' || value === '1');

const environment = z.object({
  // APP_ENV is the shared backend setting. NODE_ENV remains an alias while
  // deployment manifests are migrated.
  APP_ENV: environmentName.optional(),
  NODE_ENV: environmentName.optional(),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  DATABASE_URL: z.string().url(),
  DATABASE_SSL: environmentBoolean(),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  SECRET_KEY: z.string().min(32),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_EXPIRE_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_EXPIRE_MINUTES: z.coerce.number().int().positive().default(60),
  EMAIL_VERIFICATION_EXPIRE_MINUTES: z.coerce.number().int().positive().default(1_440),
  REFRESH_COOKIE_NAME: z.string().min(1).default('refresh_token'),
  CSRF_COOKIE_NAME: z.string().min(1).default('csrf_token'),
  COOKIE_SECURE: environmentBoolean(),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  EMAIL_DELIVERY_URL: z.string().url().optional(),
  EMAIL_DELIVERY_TOKEN: z.string().min(1).optional(),
  RATE_LIMIT_ENABLED: environmentBoolean('true'),
  RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  AUTH_RATE_LIMIT_REQUESTS: z.coerce.number().int().positive().default(5),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_PREFIX: z.string().trim().min(1).default('rate-limit'),
  REDIS_URL: z.string().url().optional(),
  TRUST_PROXY_HEADERS: environmentBoolean(),
  TRUSTED_PROXY_IPS: z.string().default(''),
  OAUTH_ENABLED: environmentBoolean(),
  OAUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_GOOGLE_AUTHORIZATION_URL: z.string().url().optional(),
  OAUTH_GOOGLE_TOKEN_URL: z.string().url().optional(),
  OAUTH_GOOGLE_USERINFO_URL: z.string().url().optional(),
  OAUTH_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  OAUTH_GOOGLE_SCOPES: z.string().min(1).optional(),
  OAUTH_GITHUB_CLIENT_ID: z.string().min(1).optional(),
  OAUTH_GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  OAUTH_GITHUB_AUTHORIZATION_URL: z.string().url().optional(),
  OAUTH_GITHUB_TOKEN_URL: z.string().url().optional(),
  OAUTH_GITHUB_USERINFO_URL: z.string().url().optional(),
  OAUTH_GITHUB_REDIRECT_URI: z.string().url().optional(),
  OAUTH_GITHUB_SCOPES: z.string().min(1).optional(),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(input = process.env) {
  const parsed = environment.parse(input);
  const appEnvironment = parsed.APP_ENV ?? parsed.NODE_ENV ?? 'development';
  const origins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);
  const trustedProxyIps = parsed.TRUSTED_PROXY_IPS.split(',').map((ip) => ip.trim()).filter(Boolean);
  const protectedEnvironment = appEnvironment === 'production' || appEnvironment === 'staging';

  if (protectedEnvironment && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in staging and production.');
  }
  if (protectedEnvironment && !parsed.DATABASE_SSL) {
    throw new Error('DATABASE_SSL must be true in staging and production.');
  }
  if (protectedEnvironment && (!parsed.EMAIL_DELIVERY_URL?.startsWith('https://') || !parsed.EMAIL_DELIVERY_TOKEN)) {
    throw new Error('EMAIL_DELIVERY_URL (HTTPS) and EMAIL_DELIVERY_TOKEN are required in staging and production.');
  }
  if (parsed.COOKIE_SAME_SITE === 'none' && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.');
  }
  if (protectedEnvironment && origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('CORS_ORIGINS must use HTTPS in staging and production.');
  }
  if (parsed.TRUST_PROXY_HEADERS && !trustedProxyIps.length) {
    throw new Error('TRUSTED_PROXY_IPS is required when TRUST_PROXY_HEADERS is enabled.');
  }
  if (trustedProxyIps.includes('*')) {
    throw new Error('TRUSTED_PROXY_IPS must list explicit proxy addresses; \'*\' is not allowed.');
  }
  if (protectedEnvironment && (!parsed.RATE_LIMIT_ENABLED || !parsed.REDIS_URL?.startsWith('rediss://'))) {
    throw new Error('RATE_LIMIT_ENABLED and a TLS REDIS_URL (rediss://) are required in staging and production.');
  }

  return { ...parsed, environment: appEnvironment, origins, trustedProxyIps };
}
