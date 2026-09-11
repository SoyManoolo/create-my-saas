import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { randomUUID } from 'node:crypto';
const dateType: 'datetime' | 'timestamptz' = process.env.NODE_ENV === 'test' ? 'datetime' : 'timestamptz';
@Entity({ name: 'oauth_states' }) @Index(['stateHash'], { unique: true })
export class OAuthState {
 @PrimaryColumn('uuid') id!: string;
 @Column() provider!: string;
 @Column({ name: 'state_hash' }) stateHash!: string;
 @Column({ name: 'code_verifier' }) codeVerifier!: string;
 @Column({ name: 'expires_at', type: dateType }) expiresAt!: Date;
 @Column({ name: 'used_at', type: dateType, nullable: true }) usedAt!: Date | null;
 @BeforeInsert() assignId(): void { this.id ??= randomUUID(); }
}
