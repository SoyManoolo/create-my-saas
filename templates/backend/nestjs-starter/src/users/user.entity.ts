import { BeforeInsert, Column, Entity, PrimaryColumn } from 'typeorm';
import { randomBytes } from 'node:crypto';

const dateColumnType: 'datetime' | 'timestamptz' =
  process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';

function uuidV7(): string {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt((5 - index) * 8)) & 0xffn);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

@Entity({ name: 'users' })
export class User {
  @PrimaryColumn('uuid')
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', nullable: true, select: false })
  passwordHash!: string | null;

  @Column()
  name!: string;

  @Column({ name: 'email_verified', default: false })
  emailVerified!: boolean;

  @Column({ name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ name: 'avatar_url', type: 'varchar', nullable: true })
  avatarUrl!: string | null;

  @Column({ name: 'deactivated_at', type: dateColumnType, nullable: true })
  deactivatedAt!: Date | null;

  @Column({ name: 'created_at', type: dateColumnType, default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @Column({
    name: 'updated_at',
    type: dateColumnType,
    default: () => 'CURRENT_TIMESTAMP',
    onUpdate: 'CURRENT_TIMESTAMP',
  })
  updatedAt!: Date;

  @BeforeInsert()
  assignId(): void {
    this.id ??= uuidV7();
  }
}
