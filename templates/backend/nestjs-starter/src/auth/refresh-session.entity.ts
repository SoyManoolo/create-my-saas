import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateColumnType: 'datetime' | 'timestamptz' =
  process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

@Entity({ name: 'refresh_sessions' })
@Index(['tokenHash'], { unique: true })
@Index(['userId'])
export class RefreshSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId!: string;
  @Column({ name: 'token_hash' }) tokenHash!: string;
  @Column({ name: 'expires_at', type: dateColumnType }) expiresAt!: Date;
  @Column({ name: 'revoked_at', type: dateColumnType, nullable: true }) revokedAt!: Date | null;
  @Column({ name: 'replaced_by_id', type: 'uuid', nullable: true }) replacedById!: string | null;
  @Column({ name: 'user_agent', type: 'varchar', nullable: true }) userAgent!: string | null;
  @Column({ name: 'ip_address', type: 'varchar', nullable: true }) ipAddress!: string | null;
  @Column({ name: 'created_at', type: dateColumnType, default: () => 'CURRENT_TIMESTAMP' }) createdAt!: Date;
  @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
