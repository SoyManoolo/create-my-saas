import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { AppError } from '../errors/app.error';
import { AUTH_RATE_LIMIT_BUCKET } from './auth-rate-limit.decorator';
import { RateLimitService } from './rate-limit.service';
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimit: RateLimitService,
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authBucket = this.reflector.get<string>(AUTH_RATE_LIMIT_BUCKET, context.getHandler());
    const routeBucket = `route:${request.method}:${request.route?.path ?? request.path}`;
    const key = `${authBucket ? `auth:${authBucket}` : routeBucket}:${request.ip}`;
    const limit = authBucket
      ? this.config.get<number>('AUTH_RATE_LIMIT_REQUESTS', 5)
      : this.config.get<number>('RATE_LIMIT_REQUESTS', 30);
    const windowSeconds = authBucket
      ? this.config.get<number>('AUTH_RATE_LIMIT_WINDOW_SECONDS', 60)
      : this.config.get<number>('RATE_LIMIT_WINDOW_SECONDS', 60);
    if (!(await this.rateLimit.consume(key, limit, windowSeconds))) {
      context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(windowSeconds));
      throw new AppError('RATE_LIMITED', 'Too many requests. Please try again later.', 429);
    }
    return true;
  }
}
