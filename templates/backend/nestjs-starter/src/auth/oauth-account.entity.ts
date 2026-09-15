import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

/** Maps an immutable provider subject to exactly one local user. */
@Entity({ name: 'oauth_accounts' })
@Index(['provider', 'providerAccountId'], { unique: true })
export class OAuthAccount {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'user_id' }) userId!: string;
  @Column() provider!: string;
  @Column({ name: 'provider_account_id' }) providerAccountId!: string;
  @Column({ name: 'created_at', type: dateType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
