import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';
export type OrganizationRole = 'owner' | 'admin' | 'member';
@Entity({ name: 'memberships' }) @Index(['organizationId', 'userId'], { unique: true })
export class Membership {
 @PrimaryColumn('uuid') id!: string;
 @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
 @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
 @Column({ type: 'varchar', default: 'member' }) role!: OrganizationRole;
 @Column({ name: 'created_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date;
 @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
