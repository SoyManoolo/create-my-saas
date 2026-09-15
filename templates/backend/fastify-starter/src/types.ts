export type PublicUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  isActive: boolean;
  createdAt: string;
};

export type StoredUser = PublicUser & { passwordHash: string | null };

export type StoredSession = {
  id: string;
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
};

export type OneTimeTokenKind = 'password_reset' | 'email_verification';

export type StoredOneTimeToken = {
  id: string;
  userId: string;
  kind: OneTimeTokenKind;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
};

export type StoredOAuthState = {
  id: string;
  provider: string;
  stateHash: string;
  codeVerifier: string;
  expiresAt: Date;
  usedAt: Date | null;
};

/** A stable external identity. Email is only used when this record is first created. */
export type StoredOAuthAccount = {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  createdAt: Date;
};

export interface SessionRepository {
  createUser(input: { email: string; name: string; passwordHash: string | null; emailVerified?: boolean }): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | undefined>;
  findUserById(id: string): Promise<StoredUser | undefined>;
  updateUserPassword(userId: string, passwordHash: string): Promise<void>;
  setEmailVerified(userId: string): Promise<void>;
  createSession(session: StoredSession): Promise<void>;
  findActiveSessionByAccessHash(accessTokenHash: string): Promise<StoredSession | undefined>;
  findActiveSessionByRefreshHash(refreshTokenHash: string): Promise<StoredSession | undefined>;
  rotateSession(input: {
    previousSessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<StoredSession | undefined>;
  revokeSession(id: string): Promise<void>;
  revokeSessionsForUser(userId: string): Promise<void>;
  createOneTimeToken(token: StoredOneTimeToken): Promise<void>;
  consumeOneTimeToken(tokenHash: string, kind: OneTimeTokenKind): Promise<StoredOneTimeToken | undefined>;
  createOAuthState(state: StoredOAuthState): Promise<void>;
  consumeOAuthState(provider: string, stateHash: string): Promise<StoredOAuthState | undefined>;
  findOAuthAccount(provider: string, providerAccountId: string): Promise<StoredOAuthAccount | undefined>;
  /** Returns the persisted account, including the winner of a concurrent insert. */
  createOAuthAccount(input: Omit<StoredOAuthAccount, 'createdAt'>): Promise<StoredOAuthAccount>;
}
