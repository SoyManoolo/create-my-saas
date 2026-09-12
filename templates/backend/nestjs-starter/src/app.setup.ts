import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppErrorFilter } from './common/errors/app-error.filter';

export function configureApplication(app: INestApplication): void {
  const appEnvironment = process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const isProduction = ['production', 'staging'].includes(appEnvironment);
  const express = app.getHttpAdapter().getInstance() as { disable(name: string): void; set(name: string, value: unknown): void };
  express.disable('x-powered-by');
  if (process.env.TRUST_PROXY_HEADERS === 'true' || process.env.TRUST_PROXY_HEADERS === '1') {
    const trustedProxyIps = (process.env.TRUSTED_PROXY_IPS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    if (!trustedProxyIps.length || trustedProxyIps.includes('*')) throw new Error('TRUSTED_PROXY_IPS must list explicit proxy addresses.');
    express.set('trust proxy', trustedProxyIps);
  }
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    response.setHeader('Permissions-Policy', 'accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    if (isProduction) response.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
    if (request.path.startsWith('/auth')) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Pragma', 'no-cache');
    }
    next();
  });
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((origin) => origin.trim()).filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Token', 'X-Request-ID'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AppErrorFilter());
}
