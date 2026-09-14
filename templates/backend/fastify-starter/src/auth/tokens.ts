import { createHash, randomBytes } from 'node:crypto';
import type { PublicUser, StoredUser } from '../types.js';

export function tokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function opaqueToken(): string {
  return randomBytes(48).toString('base64url');
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
    isActive: user.isActive,
    createdAt: user.createdAt,
  };
}
