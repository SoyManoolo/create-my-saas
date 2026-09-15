import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type { OneTimeTokenKind, SessionRepository, StoredOAuthAccount, StoredOAuthState, StoredOneTimeToken, StoredSession, StoredUser } from '../types.js';

type UserRow = {
  id: string;
  email: string;
  name: string;
  password_hash: string | null;
  email_verified: boolean;
  is_active: boolean;
  created_at: Date;
};

type OneTimeTokenRow = {
  id: string;
  user_id: string;
  kind: OneTimeTokenKind;
  token_hash: string;
  expires_at: Date;
  used_at: Date | null;
};

type OAuthStateRow = {
  id: string;
  provider: string;
  state_hash: string;
  code_verifier: string;
  expires_at: Date;
  used_at: Date | null;
};

type OAuthAccountRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_account_id: string;
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
    emailVerified: row.email_verified,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
  };
}

function oneTimeToken(row: OneTimeTokenRow): StoredOneTimeToken {
  return { id: row.id, userId: row.user_id, kind: row.kind, tokenHash: row.token_hash, expiresAt: row.expires_at, usedAt: row.used_at };
}

function oauthState(row: OAuthStateRow): StoredOAuthState {
  return { id: row.id, provider: row.provider, stateHash: row.state_hash, codeVerifier: row.code_verifier, expiresAt: row.expires_at, usedAt: row.used_at };
}

function oauthAccount(row: OAuthAccountRow): StoredOAuthAccount {
  return { id: row.id, userId: row.user_id, provider: row.provider, providerAccountId: row.provider_account_id, createdAt: row.created_at };
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

  async createUser(input: { email: string; name: string; passwordHash: string | null; emailVerified?: boolean }): Promise<StoredUser> {
    const rows = await this.sql<UserRow[]>`
      insert into users (id, email, name, password_hash, email_verified)
      values (${randomUUID()}, ${input.email}, ${input.name}, ${input.passwordHash}, ${input.emailVerified ?? false})
      returning id, email, name, password_hash, email_verified, is_active, created_at
    `;
    return publicUser(rows[0]);
  }

  async findUserByEmail(email: string): Promise<StoredUser | undefined> {
    const rows = await this.sql<UserRow[]>`
      select id, email, name, password_hash, email_verified, is_active, created_at from users where email = ${email}
    `;
    return rows[0] ? publicUser(rows[0]) : undefined;
  }

  async findUserById(id: string): Promise<StoredUser | undefined> {
    const rows = await this.sql<UserRow[]>`
      select id, email, name, password_hash, email_verified, is_active, created_at from users where id = ${id}
    `;
    return rows[0] ? publicUser(rows[0]) : undefined;
  }

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await this.sql`update users set password_hash = ${passwordHash} where id = ${userId}`;
  }

  async setEmailVerified(userId: string): Promise<void> {
    await this.sql`update users set email_verified = true where id = ${userId}`;
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

  async revokeSessionsForUser(userId: string): Promise<void> {
    await this.sql`update browser_sessions set revoked_at = now() where user_id = ${userId} and revoked_at is null`;
  }

  async createOneTimeToken(input: StoredOneTimeToken): Promise<void> {
    await this.sql.begin(async (transaction) => {
      await transaction`update auth_tokens set used_at = now() where user_id = ${input.userId} and kind = ${input.kind} and used_at is null`;
      await transaction`
        insert into auth_tokens (id, user_id, kind, token_hash, expires_at)
        values (${input.id}, ${input.userId}, ${input.kind}, ${input.tokenHash}, ${input.expiresAt})
      `;
    });
  }

  async consumeOneTimeToken(tokenHash: string, kind: OneTimeTokenKind): Promise<StoredOneTimeToken | undefined> {
    const rows = await this.sql<OneTimeTokenRow[]>`
      update auth_tokens set used_at = now()
      where token_hash = ${tokenHash} and kind = ${kind} and used_at is null and expires_at > now()
      returning id, user_id, kind, token_hash, expires_at, used_at
    `;
    return rows[0] ? oneTimeToken(rows[0]) : undefined;
  }

  async createOAuthState(input: StoredOAuthState): Promise<void> {
    await this.sql`
      insert into oauth_states (id, provider, state_hash, code_verifier, expires_at)
      values (${input.id}, ${input.provider}, ${input.stateHash}, ${input.codeVerifier}, ${input.expiresAt})
    `;
  }

  async consumeOAuthState(provider: string, stateHash: string): Promise<StoredOAuthState | undefined> {
    const rows = await this.sql<OAuthStateRow[]>`
      update oauth_states set used_at = now()
      where provider = ${provider} and state_hash = ${stateHash} and used_at is null and expires_at > now()
      returning id, provider, state_hash, code_verifier, expires_at, used_at
    `;
    return rows[0] ? oauthState(rows[0]) : undefined;
  }

  async findOAuthAccount(provider: string, providerAccountId: string): Promise<StoredOAuthAccount | undefined> {
    const rows = await this.sql<OAuthAccountRow[]>`
      select id, user_id, provider, provider_account_id, created_at from oauth_accounts
      where provider = ${provider} and provider_account_id = ${providerAccountId}
    `;
    return rows[0] ? oauthAccount(rows[0]) : undefined;
  }

  async createOAuthAccount(input: Omit<StoredOAuthAccount, 'createdAt'>): Promise<StoredOAuthAccount> {
    const rows = await this.sql<OAuthAccountRow[]>`
      insert into oauth_accounts (id, user_id, provider, provider_account_id)
      values (${input.id}, ${input.userId}, ${input.provider}, ${input.providerAccountId})
      on conflict (provider, provider_account_id) do nothing
      returning id, user_id, provider, provider_account_id, created_at
    `;
    if (rows[0]) return oauthAccount(rows[0]);
    const existing = await this.findOAuthAccount(input.provider, input.providerAccountId);
    if (!existing) throw new Error('OAuth account insert did not persist a record.');
    return existing;
  }
}
