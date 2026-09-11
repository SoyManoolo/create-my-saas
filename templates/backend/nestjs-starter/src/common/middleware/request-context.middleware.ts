import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const candidate = request.header('X-Request-ID');
    const requestId = candidate && candidate.length <= 128 && /^[\x20-\x7e]+$/.test(candidate) ? candidate : randomUUID();
    response.setHeader('X-Request-ID', requestId);
    next();
  }
}
