// Keep the fast sql.js feedback loop for local e2e runs, but exercise the
// PostgreSQL mapping whenever a test database is supplied (as it is in CI).
// This must happen before entities are imported because their timestamp
// column type depends on the active database driver.
process.env.NODE_ENV = process.env.DATABASE_URL ? 'development' : 'test';
process.env.SECRET_KEY = 'e2e-test-secret';
process.env.ACCESS_TOKEN_EXPIRE_MINUTES = '15';

if (process.env.POSTGRES_INTEGRATION_TESTS === '1' && !process.env.DATABASE_URL) {
  throw new Error('POSTGRES_INTEGRATION_TESTS requires DATABASE_URL.');
}
