import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';
@Entity({ name: 'invitations' }) @Index(['tokenHash'], { unique: true })
export class Invitation {
 @PrimaryColumn('uuid') id!: string;
 @Column({ name: 'organization_id', type: 'uuid' }) organizationId!: string;
 @Column() email!: string;
 @Column({ type: 'varchar', default: 'member' }) role!: 'admin' | 'member';
 @Column({ name: 'token_hash' }) tokenHash!: string;
 @Column({ name: 'expires_at', type: dateType }) expiresAt!: Date;
 @Column({ name: 'accepted_at', type: dateType, nullable: true }) acceptedAt!: Date | null;
 @Column({ name: 'created_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date;
 @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
