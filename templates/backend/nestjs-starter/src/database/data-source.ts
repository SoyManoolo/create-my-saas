import 'reflect-metadata';
import { DataSource } from 'typeorm';
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
import { OAuthAccount } from '../auth/oauth-account.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { CreateUsers1773139200000 } from './migrations/1773139200000-create-users';
import { AddSaasCore1773139300000 } from './migrations/1773139300000-add-saas-core';
import { HardenOrganizationInvitations1773139400000 } from './migrations/1773139400000-harden-organization-invitations';
import { AddStripeBilling1773139500000 } from './migrations/1773139500000-add-stripe-billing';
import { AddAuditLogs1773139600000 } from './migrations/1773139600000-add-audit-logs';
import { AddOAuthAccounts1773139700000 } from './migrations/1773139700000-add-oauth-accounts';
import { AddReferentialIntegrity1773139800000 } from './migrations/1773139800000-add-referential-integrity';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set before running a migration.');
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl: ['1', 'true', 'yes', 'on'].includes(process.env.DATABASE_SSL?.trim().toLowerCase() ?? '') ? { rejectUnauthorized: true } : false,
  entities: [User, AuthToken, RefreshSession, OAuthState, OAuthAccount, Organization, Membership, Invitation, BillingCustomer, Subscription, BillingEntitlement, UsageRecord, BillingWebhookEvent, AuditLog],
  migrations: [CreateUsers1773139200000, AddSaasCore1773139300000, HardenOrganizationInvitations1773139400000, AddStripeBilling1773139500000, AddAuditLogs1773139600000, AddOAuthAccounts1773139700000, AddReferentialIntegrity1773139800000],
  synchronize: false,
});
