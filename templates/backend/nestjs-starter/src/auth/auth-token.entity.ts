import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';

const dateColumnType: 'datetime' | 'timestamptz' =
  process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

@Entity({ name: 'auth_tokens' })
@Index(['tokenHash'], { unique: true })
@Index(['userId', 'kind'])
export class AuthToken {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column()
  kind!: 'password_reset' | 'email_verification';

  @Column({ name: 'token_hash' })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: dateColumnType })
  expiresAt!: Date;

  @Column({ name: 'used_at', type: dateColumnType, nullable: true })
  usedAt!: Date | null;

  @Column({ name: 'created_at', type: dateColumnType, default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @BeforeInsert()
  assignId(): void { this.id ??= randomUUID(); }
}
