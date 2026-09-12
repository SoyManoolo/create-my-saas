import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrganizationsModule } from './organizations/organizations.module';
import { BillingModule } from './billing/billing.module';

const environmentBoolean = (value: string | undefined): boolean => ['1', 'true', 'yes', 'on'].includes(value?.trim().toLowerCase() ?? '');
const hasValue = (value: string | undefined): boolean => Boolean(value?.trim());

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment: Record<string, string | undefined>) => {
        const appEnvironment = environment.APP_ENV ?? environment.NODE_ENV ?? 'development';
        const isTest = appEnvironment === 'test';
        const isProduction = appEnvironment === 'production' || appEnvironment === 'staging';
        const required = ['SECRET_KEY', ...(isTest ? [] : ['DATABASE_URL'])];
        for (const name of required) {
          if (!environment[name]) {
            throw new Error(`${name} must be set.`);
          }
        }
        const secret = environment.SECRET_KEY ?? 'test-only-secret';
        if (isProduction && (secret.length < 32 || secret === 'replace-with-a-long-random-secret')) {
          throw new Error('SECRET_KEY must be a unique value of at least 32 characters in production.');
        }
        const origins = (environment.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
        if (isProduction && (!origins.length || origins.some((origin) => !origin.startsWith('https://')))) {
          throw new Error('CORS_ORIGINS must contain explicit HTTPS origins in production.');
        }
        if (isProduction && (!environment.EMAIL_DELIVERY_URL?.startsWith('https://') || !environment.EMAIL_DELIVERY_TOKEN)) {
          throw new Error('EMAIL_DELIVERY_URL (HTTPS) and EMAIL_DELIVERY_TOKEN are required in production.');
        }
        if (isProduction && !environmentBoolean(environment.DATABASE_SSL)) {
          throw new Error('DATABASE_SSL must be enabled in production.');
        }
        const cookieSecure = environmentBoolean(environment.COOKIE_SECURE);
        const cookieSameSite = (environment.COOKIE_SAME_SITE ?? 'lax').toLowerCase();
        if (!['lax', 'strict', 'none'].includes(cookieSameSite)) throw new Error('COOKIE_SAME_SITE must be lax, strict or none.');
        if ((isProduction && !cookieSecure) || (cookieSameSite === 'none' && !cookieSecure)) throw new Error('COOKIE_SECURE is required in production and with COOKIE_SAME_SITE=none.');
        if (isProduction && (!environment.REDIS_URL?.startsWith('rediss://') || !environmentBoolean(environment.RATE_LIMIT_ENABLED))) {
          throw new Error('RATE_LIMIT_ENABLED and a TLS REDIS_URL (rediss://) are required in production.');
        }
        if (environmentBoolean(environment.TRUST_PROXY_HEADERS) && !environment.TRUSTED_PROXY_IPS?.trim()) {
          throw new Error('TRUSTED_PROXY_IPS is required when TRUST_PROXY_HEADERS is enabled.');
        }
        if (environment.TRUSTED_PROXY_IPS?.split(',').map((value) => value.trim()).includes('*')) {
          throw new Error("TRUSTED_PROXY_IPS must list explicit proxy addresses; '*' is not allowed.");
        }
        const stripeSecret = hasValue(environment.STRIPE_SECRET_KEY);
        const stripeWebhook = hasValue(environment.STRIPE_WEBHOOK_SECRET);
        if (stripeSecret !== stripeWebhook) {
          throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be configured together.');
        }
        if (stripeSecret) {
          try {
            const plans = JSON.parse(environment.STRIPE_PRICE_PLANS ?? '{}');
            if (!plans || typeof plans !== 'object' || Array.isArray(plans) || !Object.keys(plans).length) throw new Error();
          } catch {
            throw new Error('STRIPE_PRICE_PLANS must be a non-empty JSON object when Stripe is configured.');
          }
        }
        if (hasValue(environment.STRIPE_USAGE_EVENT_NAME) && !stripeSecret) {
          throw new Error('STRIPE_USAGE_EVENT_NAME requires Stripe billing to be configured.');
        }
        return {
          ...environment,
          APP_ENV: appEnvironment,
          NODE_ENV: appEnvironment,
          SECRET_KEY: environment.SECRET_KEY ?? 'test-only-secret',
          JWT_ALGORITHM: environment.JWT_ALGORITHM ?? 'HS256',
          JWT_ISSUER: environment.JWT_ISSUER ?? 'nestjs-starter',
          JWT_AUDIENCE: environment.JWT_AUDIENCE ?? 'nestjs-starter-api',
          ACCESS_TOKEN_EXPIRE_MINUTES: Number(environment.ACCESS_TOKEN_EXPIRE_MINUTES ?? 15),
          REFRESH_TOKEN_EXPIRE_DAYS: Number(environment.REFRESH_TOKEN_EXPIRE_DAYS ?? 30),
          PASSWORD_RESET_EXPIRE_MINUTES: Number(environment.PASSWORD_RESET_EXPIRE_MINUTES ?? 60),
          EMAIL_VERIFICATION_EXPIRE_MINUTES: Number(environment.EMAIL_VERIFICATION_EXPIRE_MINUTES ?? 1440),
          RATE_LIMIT_REQUESTS: Number(environment.RATE_LIMIT_REQUESTS ?? environment.RATE_LIMIT_MAX ?? 30),
          RATE_LIMIT_WINDOW_SECONDS: Number(environment.RATE_LIMIT_WINDOW_SECONDS ?? 60),
          RATE_LIMIT_PREFIX: environment.RATE_LIMIT_PREFIX?.trim() || 'rate-limit',
          RATE_LIMIT_ENABLED: environmentBoolean(environment.RATE_LIMIT_ENABLED),
          CORS_ORIGINS: environment.CORS_ORIGINS ?? 'http://localhost:3000',
          FRONTEND_URL: environment.FRONTEND_URL ?? 'http://localhost:3000',
          REFRESH_COOKIE_NAME: environment.REFRESH_COOKIE_NAME ?? 'refresh_token',
          CSRF_COOKIE_NAME: environment.CSRF_COOKIE_NAME ?? 'csrf_token',
          COOKIE_SECURE: cookieSecure,
          COOKIE_SAME_SITE: cookieSameSite,
          DATABASE_SSL: environmentBoolean(environment.DATABASE_SSL),
          OAUTH_ENABLED: environmentBoolean(environment.OAUTH_ENABLED),
        };
      },
    }),
    DatabaseModule,
    AuthModule,
    OrganizationsModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}
