import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../errors/app.error';
import { RateLimitService } from './rate-limit.service';
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: RateLimitService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = `${request.method}:${request.route?.path ?? request.path}:${request.ip}`;
    if (!(await this.rateLimit.consume(key))) throw new AppError('RATE_LIMITED', 'Too many requests. Please try again later.', 429);
    return true;
  }
}
