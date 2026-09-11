import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../common/errors/app.error';
import { UsersService } from '../users/users.service';
import { User } from '../users/user.entity';

type JwtPayload = { sub?: string; type?: string; jti?: string };
type AuthenticatedRequest = Request & { user: User };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new AppError('MISSING_TOKEN', 'An access token is required.', 401);
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(header.slice(7));
      if (payload.type !== 'access' || !payload.jti || !payload.sub || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(payload.sub)) {
        throw new AppError('INVALID_ACCESS_TOKEN', 'The access token is invalid.', 401);
      }
      request.user = await this.usersService.findActiveById(payload.sub);
      return true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new AppError('EXPIRED_TOKEN', 'The access token has expired.', 401);
      }
      throw new AppError('INVALID_ACCESS_TOKEN', 'The access token is invalid.', 401);
    }
  }
}
