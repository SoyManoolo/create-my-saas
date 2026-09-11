import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingCustomer } from './billing-customer.entity';
import { Subscription } from './subscription.entity';
@Injectable()
export class BillingService {
 constructor(@InjectRepository(BillingCustomer) private readonly customers: Repository<BillingCustomer>, @InjectRepository(Subscription) private readonly subscriptions: Repository<Subscription>) {}
 async subscription(organizationId: string): Promise<Subscription> { let subscription = await this.subscriptions.findOneBy({ organizationId }); if (!subscription) subscription = await this.subscriptions.save(this.subscriptions.create({ organizationId, plan: 'free', status: 'active', providerSubscriptionId: null, currentPeriodEnd: null, cancelAtPeriodEnd: false })); return subscription; }
 async portal(organizationId: string): Promise<{ configured: boolean; url: string | null }> { await this.subscription(organizationId); return { configured: false, url: null }; }
}
