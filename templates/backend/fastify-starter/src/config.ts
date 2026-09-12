import { z } from 'zod';

const environment = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
  DATABASE_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  CORS_ORIGINS: z.string().min(1),
  SECRET_KEY: z.string().min(32),
  ACCESS_TOKEN_EXPIRE_MINUTES: z.coerce.number().int().positive().default(15),
  REFRESH_TOKEN_EXPIRE_DAYS: z.coerce.number().int().positive().default(30),
  PASSWORD_RESET_EXPIRE_MINUTES: z.coerce.number().int().positive().default(60),
  EMAIL_VERIFICATION_EXPIRE_MINUTES: z.coerce.number().int().positive().default(1_440),
  REFRESH_COOKIE_NAME: z.string().min(1).default('refresh_token'),
  CSRF_COOKIE_NAME: z.string().min(1).default('csrf_token'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  EMAIL_DELIVERY_URL: z.string().url().optional(),
  EMAIL_DELIVERY_TOKEN: z.string().min(1).optional(),
  OAUTH_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
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
  const origins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);

  if (parsed.NODE_ENV === 'production' && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }
  if (parsed.NODE_ENV === 'production' && (!parsed.EMAIL_DELIVERY_URL?.startsWith('https://') || !parsed.EMAIL_DELIVERY_TOKEN)) {
    throw new Error('EMAIL_DELIVERY_URL (HTTPS) and EMAIL_DELIVERY_TOKEN are required in production.');
  }
  if (parsed.COOKIE_SAME_SITE === 'none' && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.');
  }
  if (parsed.NODE_ENV !== 'development' && origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('CORS_ORIGINS must use HTTPS outside development.');
  }

  return { ...parsed, origins };
}
