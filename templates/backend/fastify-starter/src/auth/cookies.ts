import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import { sendError } from '../http/errors.js';
import { opaqueToken } from './tokens.js';

export class SessionCookies {
  private readonly refreshMaxAge: number;

  constructor(private readonly config: Config) {
    this.refreshMaxAge = config.REFRESH_TOKEN_EXPIRE_DAYS * 86_400;
  }

  set(reply: FastifyReply, refreshToken: string): void {
    reply.setCookie(this.config.REFRESH_COOKIE_NAME, refreshToken, this.options(true, '/auth'));
    reply.setCookie(this.config.CSRF_COOKIE_NAME, opaqueToken(), this.options(false, '/'));
  }

  clear(reply: FastifyReply): void {
    reply.clearCookie(this.config.REFRESH_COOKIE_NAME, { path: '/auth' });
    reply.clearCookie(this.config.CSRF_COOKIE_NAME, { path: '/' });
  }

  requireCsrf(request: FastifyRequest, reply: FastifyReply): boolean {
    const cookieValue = request.cookies[this.config.CSRF_COOKIE_NAME] ?? '';
    const headerValue = request.headers['x-csrf-token'];
    const supplied = typeof headerValue === 'string' ? headerValue : '';
    if (!cookieValue || cookieValue.length !== supplied.length || !timingSafeEqual(Buffer.from(cookieValue), Buffer.from(supplied))) {
      sendError(reply, 403, 'INVALID_CSRF_TOKEN', 'CSRF token is missing or invalid.');
      return false;
    }
    return true;
  }

  refreshToken(request: FastifyRequest): string | undefined {
    return request.cookies[this.config.REFRESH_COOKIE_NAME];
  }

  private options(httpOnly: boolean, path: string) {
    return {
      httpOnly,
      secure: this.config.COOKIE_SECURE,
      sameSite: this.config.COOKIE_SAME_SITE,
      path,
      maxAge: this.refreshMaxAge,
    } as const;
  }
}
