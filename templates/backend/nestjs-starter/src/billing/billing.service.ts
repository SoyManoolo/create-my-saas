import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Stripe from 'stripe';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { AuditLogService } from '../audit/audit-log.service';
import { Organization } from '../organizations/organization.entity';
import { BillingCustomer } from './billing-customer.entity';
import { BillingEntitlement } from './billing-entitlement.entity';
import { BillingWebhookEvent } from './billing-webhook-event.entity';
import { Subscription } from './subscription.entity';
import { UsageRecord } from './usage-record.entity';

type Plan = { name: string; entitlements: Record<string, number | null> };
type PublicPlan = Plan & { priceId: string };
type PortalResult = { configured: boolean; url: string | null; reason?: string };
type UsageTotal = { metric: string; quantity: number };
type UsageInput = { organizationId: string; metric: string; quantity: number; idempotencyKey: string; recordedAt?: Date };

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(BillingCustomer) private readonly customers: Repository<BillingCustomer>,
    @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>,
    @InjectRepository(BillingEntitlement) private readonly entitlements: Repository<BillingEntitlement>,
    @InjectRepository(UsageRecord) private readonly usageRecords: Repository<UsageRecord>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
  ) {}

  async subscription(organizationId: string): Promise<Subscription> {
    let subscription = await this.subscriptions.findOneBy({ organizationId });
    if (!subscription) {
      subscription = await this.subscriptions.save(this.subscriptions.create({
        organizationId, provider: 'manual', plan: 'free', status: 'active', providerSubscriptionId: null,
        currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false,
      }));
      await this.replaceEntitlements(this.dataSource.manager, organizationId, this.freeEntitlements(), 'free', null);
    }
    return subscription;
  }

  async snapshot(organizationId: string): Promise<Subscription & { entitlements: BillingEntitlement[]; usage: UsageTotal[] }> {
    const subscription = await this.subscription(organizationId);
    const [entitlements, usage] = await Promise.all([
      this.entitlements.find({ where: { organizationId }, order: { key: 'ASC' } }),
      this.usage(organizationId, subscription.currentPeriodStart ?? subscription.createdAt),
    ]);
    return Object.assign(subscription, { entitlements, usage });
  }

  configuration(): { configured: boolean; provider: 'stripe'; usageMeterConfigured: boolean; plans: PublicPlan[] } {
    const plans = [...this.pricePlans()].map(([priceId, plan]) => ({ priceId, ...plan }));
    return { configured: this.isStripeConfigured(), provider: 'stripe', usageMeterConfigured: Boolean(this.config.get<string>('STRIPE_USAGE_EVENT_NAME')?.trim()), plans };
  }

  async checkout(organizationId: string, priceId: string, quantity: number, actorUserId: string): Promise<{ configured: boolean; url: string | null; sessionId: string | null }> {
    if (!this.isStripeConfigured()) return { configured: false, url: null, sessionId: null };
    const plan = this.pricePlans().get(priceId);
    if (!plan) throw new AppError('BILLING_PRICE_NOT_AVAILABLE', 'This billing plan is not available.', 400);
    const customer = await this.customerForOrganization(organizationId);
    const session = await this.stripe().checkout.sessions.create({
      mode: 'subscription', customer: customer.providerCustomerId, client_reference_id: organizationId,
      line_items: [{ price: priceId, quantity }],
      success_url: `${this.frontendUrl()}/organizations/${organizationId}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl()}/organizations/${organizationId}/billing?checkout=cancelled`,
      metadata: { organization_id: organizationId, plan: plan.name },
      subscription_data: { metadata: { organization_id: organizationId, plan: plan.name } },
    });
    if (!session.url) throw new AppError('BILLING_PROVIDER_ERROR', 'The billing provider did not return a checkout URL.', 502);
    await this.audit.record({
      organizationId, actorUserId, action: 'billing.checkout.created', targetType: 'billing',
      metadata: { provider: 'stripe', plan: plan.name, quantity },
    });
    return { configured: true, url: session.url, sessionId: session.id };
  }

  /** Returns an explicit unconfigured result for a starter with no Stripe credentials. */
  async portal(organizationId: string, actorUserId: string): Promise<PortalResult> {
    if (!this.isStripeConfigured()) return { configured: false, url: null, reason: 'Stripe billing is not configured.' };
    const customer = await this.customers.findOneBy({ organizationId, provider: 'stripe' });
    if (!customer) throw new AppError('BILLING_CUSTOMER_NOT_FOUND', 'Start checkout before opening the billing portal.', 409);
    const configuration = this.config.get<string>('STRIPE_PORTAL_CONFIGURATION_ID')?.trim();
    const session = await this.stripe().billingPortal.sessions.create({
      customer: customer.providerCustomerId, return_url: `${this.frontendUrl()}/organizations/${organizationId}/billing`,
      ...(configuration ? { configuration } : {}),
    });
    await this.audit.record({
      organizationId, actorUserId, action: 'billing.portal.created', targetType: 'billing', metadata: { provider: 'stripe' },
    });
    return { configured: true, url: session.url };
  }

  /** Trusted product code calls this after the product action. Browser clients cannot self-report billable usage. */
  async recordUsage(input: UsageInput): Promise<{ record: UsageRecord; reportedToProvider: boolean }> {
    if (!/^[a-z][a-z0-9_.-]{0,99}$/i.test(input.metric) || !Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.idempotencyKey.length > 255) {
      throw new AppError('INVALID_USAGE_RECORD', 'Usage records require a valid metric, positive quantity and idempotency key.', 400);
    }
    const existing = await this.usageRecords.findOneBy({ organizationId: input.organizationId, idempotencyKey: input.idempotencyKey });
    if (existing) return { record: existing, reportedToProvider: this.canReportUsage() };

    let reportedToProvider = false;
    if (this.canReportUsage()) {
      const customer = await this.customers.findOneBy({ organizationId: input.organizationId, provider: 'stripe' });
      if (customer) {
        await this.stripe().billing.meterEvents.create({
          event_name: this.config.getOrThrow<string>('STRIPE_USAGE_EVENT_NAME').trim(), identifier: input.idempotencyKey,
          timestamp: Math.floor((input.recordedAt ?? new Date()).getTime() / 1000),
          payload: { stripe_customer_id: customer.providerCustomerId, value: String(input.quantity) },
        });
        reportedToProvider = true;
      }
    }
    try {
      const record = await this.usageRecords.save(this.usageRecords.create({
        organizationId: input.organizationId, metric: input.metric, quantity: input.quantity,
        idempotencyKey: input.idempotencyKey, recordedAt: input.recordedAt ?? new Date(),
      }));
      return { record, reportedToProvider };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const record = await this.usageRecords.findOneByOrFail({ organizationId: input.organizationId, idempotencyKey: input.idempotencyKey });
        return { record, reportedToProvider };
      }
      throw error;
    }
  }

  async assertEntitled(organizationId: string, key: string, quantity = 1): Promise<void> {
    if (!Number.isSafeInteger(quantity) || quantity < 1) throw new AppError('INVALID_ENTITLEMENT_QUANTITY', 'Entitlement quantity must be positive.', 400);
    const entitlement = await this.entitlements.findOneBy({ organizationId, key });
    if (!entitlement?.enabled || (entitlement.expiresAt && entitlement.expiresAt <= new Date())) {
      throw new AppError('ENTITLEMENT_REQUIRED', 'Your plan does not include this feature.', 403);
    }
    if (entitlement.limit === null) return;
    const subscription = await this.subscription(organizationId);
    const usage = await this.usageForMetric(organizationId, key, subscription.currentPeriodStart ?? subscription.createdAt);
    if (usage + quantity > entitlement.limit) throw new AppError('ENTITLEMENT_LIMIT_REACHED', 'Your plan usage limit has been reached.', 403);
  }

  async handleStripeWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ accepted: boolean; duplicate: boolean }> {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    if (!secret) throw new AppError('BILLING_NOT_CONFIGURED', 'Stripe webhooks are not configured.', 503);
    if (!rawBody || !signature) throw new AppError('INVALID_WEBHOOK_SIGNATURE', 'Stripe webhook signature is invalid.', 400);
    let event: Stripe.Event;
    try { event = this.stripe().webhooks.constructEvent(rawBody, signature, secret, this.config.get<number>('STRIPE_WEBHOOK_TOLERANCE_SECONDS', 300)); }
    catch { throw new AppError('INVALID_WEBHOOK_SIGNATURE', 'Stripe webhook signature is invalid.', 400); }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const events = manager.getRepository(BillingWebhookEvent);
        if (await events.findOneBy({ provider: 'stripe', providerEventId: event.id })) return { accepted: true, duplicate: true };
        const delivery = await events.save(events.create({ provider: 'stripe', providerEventId: event.id, processedAt: null }));
        await this.applyStripeEvent(manager, event);
        delivery.processedAt = new Date();
        await events.save(delivery);
        return { accepted: true, duplicate: false };
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) return { accepted: true, duplicate: true };
      throw error;
    }
  }

  private async applyStripeEvent(manager: EntityManager, event: Stripe.Event): Promise<void> {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const organizationId = this.organizationId(session.metadata?.organization_id ?? session.client_reference_id);
      const customerId = this.objectId(session.customer);
      if (organizationId && customerId) await this.upsertCustomer(manager, organizationId, customerId);
      return;
    }
    if (event.type.startsWith('customer.subscription.')) await this.syncStripeSubscription(manager, event.data.object as Stripe.Subscription);
  }

  private async syncStripeSubscription(manager: EntityManager, stripeSubscription: Stripe.Subscription): Promise<void> {
    const customerId = this.objectId(stripeSubscription.customer);
    if (!customerId) throw new AppError('INVALID_BILLING_WEBHOOK', 'Stripe subscription customer is missing.', 400);
    const customers = manager.getRepository(BillingCustomer);
    const customer = await customers.findOneBy({ provider: 'stripe', providerCustomerId: customerId });
    const metadataOrganizationId = this.organizationId(stripeSubscription.metadata.organization_id);
    if (customer && metadataOrganizationId && customer.organizationId !== metadataOrganizationId) throw new AppError('BILLING_ORGANIZATION_MISMATCH', 'Stripe customer belongs to another organization.', 400);
    const organizationId = customer?.organizationId ?? metadataOrganizationId;
    if (!organizationId) return; // A Stripe subscription not created by this application.
    if (!customer) await this.upsertCustomer(manager, organizationId, customerId);

    const priceId = stripeSubscription.items.data[0]?.price.id;
    const plan = priceId ? this.pricePlans().get(priceId) : undefined;
    const subscriptions = manager.getRepository(Subscription);
    let subscription = await subscriptions.findOneBy({ organizationId });
    if (!subscription) subscription = subscriptions.create({ organizationId, provider: 'stripe', plan: 'free', status: 'inactive', providerSubscriptionId: null, currentPeriodStart: null, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    if (subscription.providerSubscriptionId && subscription.providerSubscriptionId !== stripeSubscription.id) throw new AppError('BILLING_SUBSCRIPTION_MISMATCH', 'Organization already has a different Stripe subscription.', 400);
    subscription.provider = 'stripe'; subscription.providerSubscriptionId = stripeSubscription.id;
    subscription.plan = plan?.name ?? 'unknown'; subscription.status = stripeSubscription.status;
    subscription.currentPeriodStart = this.epochToDate(stripeSubscription.items.data[0]?.current_period_start);
    subscription.currentPeriodEnd = this.epochToDate(stripeSubscription.items.data[0]?.current_period_end);
    subscription.cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;
    await subscriptions.save(subscription);
    const canUsePlan = ['active', 'trialing'].includes(stripeSubscription.status) && Boolean(plan);
    await this.replaceEntitlements(
      manager,
      organizationId,
      canUsePlan ? plan!.entitlements : this.freeEntitlements(),
      canUsePlan ? plan!.name : 'free',
      canUsePlan ? subscription.currentPeriodEnd : null,
    );
  }

  private async customerForOrganization(organizationId: string): Promise<BillingCustomer> {
    const existing = await this.customers.findOneBy({ organizationId, provider: 'stripe' });
    if (existing) return existing;
    const organization = await this.organizations.findOneBy({ id: organizationId });
    if (!organization) throw new AppError('ORGANIZATION_NOT_FOUND', 'Organization was not found.', 404);
    const stripeCustomer = await this.stripe().customers.create(
      { name: organization.name, metadata: { organization_id: organizationId } },
      { idempotencyKey: `billing-customer:${organizationId}` },
    );
    try { return await this.customers.save(this.customers.create({ organizationId, provider: 'stripe', providerCustomerId: stripeCustomer.id })); }
    catch (error) {
      if (this.isUniqueViolation(error)) return this.customers.findOneByOrFail({ organizationId, provider: 'stripe' });
      throw error;
    }
  }

  private async upsertCustomer(manager: EntityManager, organizationId: string, providerCustomerId: string): Promise<BillingCustomer> {
    const customers = manager.getRepository(BillingCustomer);
    const byOrganization = await customers.findOneBy({ organizationId });
    if (byOrganization && (byOrganization.provider !== 'stripe' || byOrganization.providerCustomerId !== providerCustomerId)) throw new AppError('BILLING_CUSTOMER_MISMATCH', 'Organization already has another billing customer.', 400);
    const byProvider = await customers.findOneBy({ provider: 'stripe', providerCustomerId });
    if (byProvider && byProvider.organizationId !== organizationId) throw new AppError('BILLING_CUSTOMER_MISMATCH', 'Stripe customer belongs to another organization.', 400);
    return byOrganization ?? byProvider ?? customers.save(customers.create({ organizationId, provider: 'stripe', providerCustomerId }));
  }

  private async replaceEntitlements(manager: EntityManager, organizationId: string, values: Record<string, number | null>, source: string, expiresAt: Date | null): Promise<void> {
    const entitlements = manager.getRepository(BillingEntitlement);
    await entitlements.delete({ organizationId });
    const rows = Object.entries(values).map(([key, limit]) => entitlements.create({ organizationId, key, limit, enabled: true, source, expiresAt }));
    if (rows.length) await entitlements.save(rows);
  }

  private async usage(organizationId: string, since: Date): Promise<UsageTotal[]> {
    const rows = await this.usageRecords.createQueryBuilder('usage').select('usage.metric', 'metric').addSelect('COALESCE(SUM(usage.quantity), 0)', 'quantity')
      .where('usage.organization_id = :organizationId AND usage.recorded_at >= :since', { organizationId, since }).groupBy('usage.metric').orderBy('usage.metric', 'ASC').getRawMany<{ metric: string; quantity: string }>();
    return rows.map((row) => ({ metric: row.metric, quantity: Number(row.quantity) }));
  }

  private async usageForMetric(organizationId: string, metric: string, since: Date): Promise<number> {
    const value = await this.usageRecords.createQueryBuilder('usage').select('COALESCE(SUM(usage.quantity), 0)', 'quantity')
      .where('usage.organization_id = :organizationId AND usage.metric = :metric AND usage.recorded_at >= :since', { organizationId, metric, since }).getRawOne<{ quantity: string }>();
    return Number(value?.quantity ?? 0);
  }

  private stripe(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY')?.trim();
    if (!key) throw new AppError('BILLING_NOT_CONFIGURED', 'Stripe billing is not configured.', 503);
    return new Stripe(key);
  }
  private isStripeConfigured(): boolean { return Boolean(this.config.get<string>('STRIPE_SECRET_KEY')?.trim() && this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() && this.pricePlans().size); }
  private canReportUsage(): boolean { return this.isStripeConfigured() && Boolean(this.config.get<string>('STRIPE_USAGE_EVENT_NAME')?.trim()); }
  private pricePlans(): Map<string, Plan> { return this.parsePlans(this.config.get<string>('STRIPE_PRICE_PLANS') ?? '{}', 'STRIPE_PRICE_PLANS'); }
  private freeEntitlements(): Record<string, number | null> { return this.parseEntitlements(this.config.get<string>('BILLING_FREE_ENTITLEMENTS') ?? '{}', 'BILLING_FREE_ENTITLEMENTS'); }

  private parsePlans(raw: string, setting: string): Map<string, Plan> {
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} must be valid JSON.`, 500); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} must be an object.`, 500);
    return new Map(Object.entries(value as Record<string, unknown>).map(([priceId, plan]) => {
      if (!/^price_[A-Za-z0-9]+$/.test(priceId) || !plan || typeof plan !== 'object' || Array.isArray(plan)) throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} contains an invalid plan.`, 500);
      const typed = plan as { name?: unknown; entitlements?: unknown };
      if (typeof typed.name !== 'string' || !typed.name.trim()) throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} plans require a name.`, 500);
      return [priceId, { name: typed.name, entitlements: this.parseEntitlements(JSON.stringify(typed.entitlements ?? {}), setting) }];
    }));
  }

  private parseEntitlements(raw: string, setting: string): Record<string, number | null> {
    let value: unknown; try { value = JSON.parse(raw); } catch { throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} must be valid JSON.`, 500); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} must be an object.`, 500);
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, limit]) => {
      if (!/^[a-z][a-z0-9_.-]{0,99}$/i.test(key) || (limit !== null && (!Number.isSafeInteger(limit) || (limit as number) < 0))) throw new AppError('INVALID_BILLING_CONFIGURATION', `${setting} contains an invalid entitlement.`, 500);
      return [key, limit as number | null];
    }));
  }

  private frontendUrl(): string { return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/$/, ''); }
  private epochToDate(value: number | null | undefined): Date | null { return typeof value === 'number' ? new Date(value * 1000) : null; }
  private objectId(value: string | { id: string } | null): string | null { return typeof value === 'string' ? value : value?.id ?? null; }
  private organizationId(value: string | null | undefined): string | null { return value && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value) ? value : null; }
  private isUniqueViolation(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505'; }
}
