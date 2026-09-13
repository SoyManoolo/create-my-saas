import postgres from 'postgres';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { PostgresSessionRepository } from './db/postgres-repository.js';

const config = loadConfig();
const sql = postgres(config.DATABASE_URL, { ssl: config.DATABASE_SSL ? 'verify-full' : false });
const app = await createApp({ config, repository: new PostgresSessionRepository(sql) });

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}

async function close() {
  await app.close();
  await sql.end();
}

process.on('SIGINT', close);
process.on('SIGTERM', close);
