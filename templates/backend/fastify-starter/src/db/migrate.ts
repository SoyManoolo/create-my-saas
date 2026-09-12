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
    password_hash text not null,
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
`;

const sql = postgres(loadConfig().DATABASE_URL);

try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe(migration);
    await transaction`
      insert into schema_migrations (id) values ('0001_browser_sessions') on conflict (id) do nothing
    `;
  });
  console.log('Database migration 0001_browser_sessions is applied.');
} finally {
  await sql.end();
}
