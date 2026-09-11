import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';
@Entity({ name: 'billing_customers' })
export class BillingCustomer { @PrimaryColumn('uuid') id!: string; @Column({ name: 'organization_id', type: 'uuid', unique: true }) organizationId!: string; @Column() provider!: string; @Column({ name: 'provider_customer_id', unique: true }) providerCustomerId!: string; @Column({ name: 'created_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date; @BeforeInsert() assignId(): void { this.id ??= randomUUID(); } }
