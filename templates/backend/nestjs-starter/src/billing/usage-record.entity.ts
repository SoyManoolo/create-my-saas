import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

@Entity({ name: 'usage_records' })
@Index('UQ_usage_records_organization_idempotency', ['organizationId', 'idempotencyKey'], { unique: true })
@Index('IDX_usage_records_organization_metric_recorded', ['organizationId', 'metric', 'recordedAt'])
export class UsageRecord {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column() metric!: string;
  @Column({ type: 'integer' }) quantity!: number;
  @Column({ name: 'idempotency_key', type: 'varchar' }) idempotencyKey!: string;
  @Column({ name: 'recorded_at', type: dateType }) recordedAt!: Date;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
