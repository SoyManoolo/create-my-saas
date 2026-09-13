import { randomUUID } from 'node:crypto';
import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';

const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

@Entity({ name: 'audit_logs' })
@Index('IX_audit_logs_org_created_id', ['organizationId', 'createdAt', 'id'])
export class AuditLog {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
  @Index() @Column({ name: 'actor_user_id', type: 'uuid', nullable: true }) actorUserId!: string | null;
  @Column({ type: 'varchar', length: 80 }) action!: string;
  @Column({ name: 'target_type', type: 'varchar', length: 40 }) targetType!: string;
  @Column({ name: 'target_id', type: 'varchar', length: 255, nullable: true }) targetId!: string | null;
  @Column({ type: 'simple-json', default: '{}' }) metadata!: Record<string, string | number | boolean | null>;
  @Column({ name: 'created_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
