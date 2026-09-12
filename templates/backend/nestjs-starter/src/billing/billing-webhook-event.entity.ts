import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

/** Stores delivery identifiers only; webhook payloads can contain unnecessary personal data. */
@Entity({ name: 'billing_webhook_events' })
@Index('UQ_billing_webhook_events_provider_event', ['provider', 'providerEventId'], { unique: true })
export class BillingWebhookEvent {
  @PrimaryColumn('uuid') id!: string;
  @Column() provider!: string;
  @Column({ name: 'provider_event_id' }) providerEventId!: string;
  @Column({ name: 'received_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) receivedAt!: Date;
  @Column({ name: 'processed_at', type: dateType, nullable: true }) processedAt!: Date | null;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
