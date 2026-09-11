import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { BillingController } from './billing.controller';
import { BillingCustomer } from './billing-customer.entity';
import { BillingService } from './billing.service';
import { Subscription } from './subscription.entity';
@Module({ imports: [AuthModule, OrganizationsModule, TypeOrmModule.forFeature([BillingCustomer, Subscription])], controllers: [BillingController], providers: [BillingService], exports: [BillingService] }) export class BillingModule {}
