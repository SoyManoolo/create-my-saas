import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshSession } from './refresh-session.entity';
import { AuthToken } from './auth-token.entity';
import { OAuthState } from './oauth-state.entity';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { RateLimitService } from '../common/rate-limit/rate-limit.service';

@Global()
@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([RefreshSession, AuthToken, OAuthState]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('SECRET_KEY'),
        signOptions: {
          algorithm: config.get<string>('ALGORITHM', 'HS256') as 'HS256',
          expiresIn: `${config.get<number>('ACCESS_TOKEN_EXPIRE_MINUTES', 30)}m`,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RateLimitService, RateLimitGuard],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
