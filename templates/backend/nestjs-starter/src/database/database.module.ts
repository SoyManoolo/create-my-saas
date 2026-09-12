import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { AuthToken } from '../auth/auth-token.entity';
import { RefreshSession } from '../auth/refresh-session.entity';
import { Organization } from '../organizations/organization.entity';
import { Membership } from '../organizations/membership.entity';
import { Invitation } from '../organizations/invitation.entity';
import { BillingCustomer } from '../billing/billing-customer.entity';
import { Subscription } from '../billing/subscription.entity';
import { BillingEntitlement } from '../billing/billing-entitlement.entity';
import { UsageRecord } from '../billing/usage-record.entity';
import { BillingWebhookEvent } from '../billing/billing-webhook-event.entity';
import { OAuthState } from '../auth/oauth-state.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        if (config.get<string>('NODE_ENV') === 'test') {
          return {
            type: 'sqljs',
            autoSave: false,
            synchronize: true,
            entities: [User, AuthToken, RefreshSession, OAuthState, Organization, Membership, Invitation, BillingCustomer, Subscription, BillingEntitlement, UsageRecord, BillingWebhookEvent],
          };
        }

        return {
          type: 'postgres',
          url: config.getOrThrow<string>('DATABASE_URL'),
          autoLoadEntities: true,
          synchronize: false,
          ssl: config.get<boolean>('DATABASE_SSL', false) ? { rejectUnauthorized: true } : false,
        };
      },
    }),
  ],
})
export class DatabaseModule {}
