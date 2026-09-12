import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingController, BillingWebhookController } from './billing.controller';
import { BillingCustomer } from './billing-customer.entity';
import { BillingService } from './billing.service';
import { Subscription } from './subscription.entity';
import { BillingEntitlement } from './billing-entitlement.entity';
import { UsageRecord } from './usage-record.entity';
import { BillingWebhookEvent } from './billing-webhook-event.entity';
import { Organization } from '../organizations/organization.entity';
@Module({ imports: [AuthModule, OrganizationsModule, TypeOrmModule.forFeature([BillingCustomer, Subscription, BillingEntitlement, UsageRecord, BillingWebhookEvent, Organization])], controllers: [BillingController, BillingWebhookController], providers: [BillingService], exports: [BillingService] }) export class BillingModule {}
