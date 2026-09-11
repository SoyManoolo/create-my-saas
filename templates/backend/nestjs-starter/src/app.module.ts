import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { DatabaseModule } from './database/database.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrganizationsModule } from './organizations/organizations.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (environment: Record<string, string | undefined>) => {
        const isTest = environment.NODE_ENV === 'test';
        const required = ['SECRET_KEY', ...(isTest ? [] : ['DATABASE_URL'])];
        for (const name of required) {
          if (!environment[name]) {
            throw new Error(`${name} must be set.`);
          }
        }
        return {
          ...environment,
          SECRET_KEY: environment.SECRET_KEY ?? 'test-only-secret',
          ALGORITHM: environment.ALGORITHM ?? 'HS256',
          ACCESS_TOKEN_EXPIRE_MINUTES: Number(environment.ACCESS_TOKEN_EXPIRE_MINUTES ?? 30),
          REFRESH_TOKEN_EXPIRE_DAYS: Number(environment.REFRESH_TOKEN_EXPIRE_DAYS ?? 30),
          PASSWORD_RESET_EXPIRE_MINUTES: Number(environment.PASSWORD_RESET_EXPIRE_MINUTES ?? 60),
          EMAIL_VERIFICATION_EXPIRE_MINUTES: Number(environment.EMAIL_VERIFICATION_EXPIRE_MINUTES ?? 1440),
          RATE_LIMIT_MAX: Number(environment.RATE_LIMIT_MAX ?? 30),
          RATE_LIMIT_WINDOW_SECONDS: Number(environment.RATE_LIMIT_WINDOW_SECONDS ?? 60),
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
