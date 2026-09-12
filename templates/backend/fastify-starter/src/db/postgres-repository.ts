import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { SessionRepository, StoredSession, StoredUser } from '../types.js';

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  created_at: Date;
};

type SessionRow = {
  id: string;
  user_id: string;
  access_token_hash: string;
  refresh_token_hash: string;
  access_expires_at: Date;
  refresh_expires_at: Date;
  revoked_at: Date | null;
};

function publicUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };
}

function session(row: SessionRow): StoredSession {
  return {
    id: row.id,
    userId: row.user_id,
    accessTokenHash: row.access_token_hash,
    refreshTokenHash: row.refresh_token_hash,
    accessExpiresAt: row.access_expires_at,
    refreshExpiresAt: row.refresh_expires_at,
    revokedAt: row.revoked_at,
  };
}

export class PostgresSessionRepository implements SessionRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async createUser(input: { email: string; name: string; passwordHash: string }): Promise<StoredUser> {
    const rows = await this.sql<UserRow[]>`
      insert into users (id, email, name, password_hash)
      values (${randomUUID()}, ${input.email}, ${input.name}, ${input.passwordHash})
      returning id, email, name, password_hash, created_at
    `;
    return publicUser(rows[0]);
  }

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const rows = await this.sql<UserRow[]>`
      select id, email, name, password_hash, created_at from users where email = ${email}
    `;
    return rows[0] ? publicUser(rows[0]) : undefined;
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    const rows = await this.sql<UserRow[]>`
      select id, email, name, password_hash, created_at from users where id = ${id}
    `;
    return rows[0] ? publicUser(rows[0]) : undefined;
  }

  async createSession(input: StoredSession): Promise<void> {
    await this.sql`
      insert into browser_sessions (
        id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at
      ) values (
        ${input.id}, ${input.userId}, ${input.accessTokenHash}, ${input.refreshTokenHash},
        ${input.accessExpiresAt}, ${input.refreshExpiresAt}
      )
    `;
  }

  async findActiveSessionByAccessHash(accessTokenHash: string): Promise<StoredSession | undefined> {
    const rows = await this.sql<SessionRow[]>`
      select id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, revoked_at
      from browser_sessions
      where access_token_hash = ${accessTokenHash} and revoked_at is null and access_expires_at > now()
    `;
    return rows[0] ? session(rows[0]) : undefined;
  }

  async findActiveSessionByRefreshHash(refreshTokenHash: string): Promise<StoredSession | undefined> {
    const rows = await this.sql<SessionRow[]>`
      select id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, revoked_at
      from browser_sessions
      where refresh_token_hash = ${refreshTokenHash} and revoked_at is null and refresh_expires_at > now()
    `;
    return rows[0] ? session(rows[0]) : undefined;
  }

  async rotateSession(input: {
    previousSessionId: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessExpiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<StoredSession | undefined> {
    return this.sql.begin(async (transaction) => {
      const previous = await transaction<SessionRow[]>`
        update browser_sessions set revoked_at = now()
        where id = ${input.previousSessionId} and revoked_at is null and refresh_expires_at > now()
        returning id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, revoked_at
      `;
      if (!previous[0]) return undefined;
      const rows = await transaction<SessionRow[]>`
        insert into browser_sessions (
          id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at
        ) values (
          ${randomUUID()}, ${previous[0].user_id}, ${input.accessTokenHash}, ${input.refreshTokenHash},
          ${input.accessExpiresAt}, ${input.refreshExpiresAt}
        )
        returning id, user_id, access_token_hash, refresh_token_hash, access_expires_at, refresh_expires_at, revoked_at
      `;
      return session(rows[0]);
    });
  }

  async revokeSession(id: string): Promise<void> {
    await this.sql`update browser_sessions set revoked_at = now() where id = ${id} and revoked_at is null`;
  }
}
