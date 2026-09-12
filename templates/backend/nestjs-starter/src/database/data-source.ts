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
import { OAuthState } from '../auth/oauth-state.entity';
import { CreateUsers1773139200000 } from './migrations/1773139200000-create-users';
import { AddSaasCore1773139300000 } from './migrations/1773139300000-add-saas-core';
import { HardenOrganizationInvitations1773139400000 } from './migrations/1773139400000-harden-organization-invitations';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be set before running a migration.');
}

export default new DataSource({
  type: 'postgres',
  url: databaseUrl,
  ssl: ['1', 'true', 'yes', 'on'].includes(process.env.DATABASE_SSL?.trim().toLowerCase() ?? '') ? { rejectUnauthorized: true } : false,
  entities: [User, AuthToken, RefreshSession, OAuthState, Organization, Membership, Invitation, BillingCustomer, Subscription],
  migrations: [CreateUsers1773139200000, AddSaasCore1773139300000, HardenOrganizationInvitations1773139400000],
  synchronize: false,
});
