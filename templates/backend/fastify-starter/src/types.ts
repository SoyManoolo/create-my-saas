export type PublicUser = {
  id: string;
  email: string;
  name: string;
  createdAt: string;
};

export type StoredUser = PublicUser & { passwordHash: string };

export type StoredSession = {
  id: string;
  userId: string;
  accessTokenHash: string;
  refreshTokenHash: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  revokedAt: Date | null;
};

export interface SessionRepository {
  createUser(input: { email: string; name: string; passwordHash: string }): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | undefined>;
  findUserById(id: string): Promise<StoredUser | undefined>;
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
}
