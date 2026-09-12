import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

@Entity({ name: 'billing_entitlements' })
@Index('UQ_billing_entitlements_organization_key', ['organizationId', 'key'], { unique: true })
export class BillingEntitlement {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Column() key!: string;
  /** Null is an enabled entitlement without a numeric cap. */
  @Column({ name: 'limit_value', type: 'integer', nullable: true }) limit!: number | null;
  @Column({ default: true }) enabled!: boolean;
  @Column({ default: 'free' }) source!: string;
  @Column({ name: 'expires_at', type: dateType, nullable: true }) expiresAt!: Date | null;
  @Column({ name: 'updated_at', type: dateType, default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }) updatedAt!: Date;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
