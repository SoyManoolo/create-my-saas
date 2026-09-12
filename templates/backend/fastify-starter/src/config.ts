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
  REFRESH_COOKIE_NAME: z.string().min(1).default('refresh_token'),
  CSRF_COOKIE_NAME: z.string().min(1).default('csrf_token'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(input = process.env) {
  const parsed = environment.parse(input);
  const origins = parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean);

  if (parsed.NODE_ENV === 'production' && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production.');
  }
  if (parsed.COOKIE_SAME_SITE === 'none' && !parsed.COOKIE_SECURE) {
    throw new Error('COOKIE_SAME_SITE=none requires COOKIE_SECURE=true.');
  }
  if (parsed.NODE_ENV !== 'development' && origins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('CORS_ORIGINS must use HTTPS outside development.');
  }

  return { ...parsed, origins };
}
