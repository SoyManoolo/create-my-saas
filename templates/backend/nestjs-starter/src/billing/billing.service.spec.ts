import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { DataSource, Repository } from 'typeorm';
import { BillingCustomer } from './billing-customer.entity';
import { BillingEntitlement } from './billing-entitlement.entity';
import { BillingService } from './billing.service';
import { BillingWebhookEvent } from './billing-webhook-event.entity';
import { Subscription } from './subscription.entity';
import { UsageRecord } from './usage-record.entity';
import { Organization } from '../organizations/organization.entity';

describe('BillingService', () => {
  function setup(values: Record<string, unknown> = {}) {
    const repository = () => ({ findOneBy: jest.fn(), find: jest.fn(), save: jest.fn(), create: jest.fn((value) => value), delete: jest.fn(), createQueryBuilder: jest.fn() });
    const customers = repository(); const subscriptions = repository(); const entitlements = repository(); const usage = repository(); const events = repository(); const organizations = repository();
    const manager = { getRepository: jest.fn((entity) => entity === BillingWebhookEvent ? events : repository()) };
    const dataSource = { manager, transaction: jest.fn(async (callback) => callback(manager)) };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
      getOrThrow: jest.fn((key: string) => values[key]),
    };
    return {
      service: new BillingService(
        customers as unknown as Repository<BillingCustomer>,
        subscriptions as unknown as Repository<Subscription>,
        entitlements as unknown as Repository<BillingEntitlement>,
        usage as unknown as Repository<UsageRecord>,
        organizations as unknown as Repository<Organization>,
        dataSource as unknown as DataSource,
        config as unknown as ConfigService,
      ),
      events, config,
    };
  }

  it('makes an unconfigured portal explicit instead of returning a misleading link', async () => {
    const { service } = setup();
    await expect(service.portal('fdafb779-347e-4ec0-b240-859f2e3985b4')).resolves.toEqual({ configured: false, url: null, reason: 'Stripe billing is not configured.' });
    await expect(service.checkout('fdafb779-347e-4ec0-b240-859f2e3985b4', 'price_pro_monthly', 1)).resolves.toEqual({ configured: false, url: null, sessionId: null });
  });

  it('uses Stripe official signature verification over the unmodified raw body and deduplicates deliveries', async () => {
    const key = 'sk_test_123456789012345678901234'; const secret = 'whsec_test_secret';
    const { service, events } = setup({ STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: secret, STRIPE_PRICE_PLANS: '{"price_pro_monthly":{"name":"pro","entitlements":{}}}' });
    const payload = JSON.stringify({ id: 'evt_123', object: 'event', type: 'product.created', data: { object: {} } });
    const signature = new Stripe(key).webhooks.generateTestHeaderString({ payload, secret });
    events.findOneBy.mockResolvedValue({ id: 'known-event' });

    await expect(service.handleStripeWebhook(Buffer.from(payload), signature)).resolves.toEqual({ accepted: true, duplicate: true });
    await expect(service.handleStripeWebhook(Buffer.from(`${payload} `), signature)).rejects.toMatchObject({ code: 'INVALID_WEBHOOK_SIGNATURE' });
  });
});
