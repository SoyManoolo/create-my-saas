import postgres from 'postgres';
import { loadConfig } from '../config.js';

const migration = `
  create table if not exists schema_migrations (
    id text primary key,
    applied_at timestamptz not null default now()
  );

  create table if not exists users (
    id uuid primary key,
    email text not null unique,
    name text not null,
    password_hash text,
    email_verified boolean not null default false,
    is_active boolean not null default true,
    created_at timestamptz not null default now()
  );

  create table if not exists browser_sessions (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    access_token_hash text not null unique,
    refresh_token_hash text not null unique,
    access_expires_at timestamptz not null,
    refresh_expires_at timestamptz not null,
    revoked_at timestamptz null,
    created_at timestamptz not null default now()
  );
  create index if not exists browser_sessions_active_refresh_idx
    on browser_sessions (refresh_token_hash) where revoked_at is null;

  create table if not exists auth_tokens (
    id uuid primary key,
    user_id uuid not null references users(id) on delete cascade,
    kind text not null check (kind in ('password_reset', 'email_verification')),
    token_hash text not null unique,
    expires_at timestamptz not null,
    used_at timestamptz null,
    created_at timestamptz not null default now()
  );
  create index if not exists auth_tokens_active_lookup_idx
    on auth_tokens (token_hash, kind) where used_at is null;

  create table if not exists oauth_states (
    id uuid primary key,
    provider text not null check (provider in ('google', 'github')),
    state_hash text not null unique,
    code_verifier text not null,
    expires_at timestamptz not null,
    used_at timestamptz null,
    created_at timestamptz not null default now()
  );
  create index if not exists oauth_states_active_lookup_idx
    on oauth_states (provider, state_hash) where used_at is null;

  alter table users add column if not exists email_verified boolean not null default false;
  alter table users add column if not exists is_active boolean not null default true;
  alter table users alter column password_hash drop not null;
`;

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { ssl: config.DATABASE_SSL ? 'verify-full' : false });

try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(migration);
    await transaction`
      insert into schema_migrations (id) values ('0001_browser_sessions') on conflict (id) do nothing
    `;
    await transaction`
      insert into schema_migrations (id) values ('0002_auth_recovery_email_oauth') on conflict (id) do nothing
    `;
  });
  console.log('Database migrations through 0002_auth_recovery_email_oauth are applied.');
} finally {
  await sql.end();
}
