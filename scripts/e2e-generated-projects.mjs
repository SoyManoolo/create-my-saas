import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const options = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, values) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), values[index + 1]]);
  return pairs;
}, []));
const backend = options.backend;
const frontend = options.frontend;

if (!['fastapi', 'nestjs'].includes(backend) || !['nextjs', 'react-router', 'astro'].includes(frontend)) {
  throw new Error('Usage: node scripts/e2e-generated-projects.mjs --backend fastapi|nestjs --frontend nextjs|react-router|astro');
}

const apiPort = backend === 'fastapi' ? 8000 : 3001;
const frontendPort = 3100;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const e2eEnvironment = {
  ...process.env,
  APP_ENV: 'development',
  NODE_ENV: 'development',
  PORT: String(apiPort),
  DATABASE_URL: backend === 'fastapi'
    ? 'postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/app'
    : 'postgresql://postgres:postgres@127.0.0.1:5432/app',
  REDIS_URL: 'redis://127.0.0.1:6379',
  SECRET_KEY: 'generated-project-e2e-secret-that-is-long-enough-to-be-safe',
  FRONTEND_URL: frontendOrigin,
  CORS_ORIGINS: frontendOrigin,
  PUBLIC_SITE_URL: frontendOrigin,
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  RATE_LIMIT_ENABLED: 'true',
  // External providers are deliberately controlled in this E2E suite: their
  // credentials are absent, so registration cannot contact email, OAuth, or
  // Stripe. Their real integrations belong to the separately configured staging run.
  OAUTH_ENABLED: 'false',
  OAUTH_GOOGLE_CLIENT_ID: '',
  OAUTH_GOOGLE_CLIENT_SECRET: '',
  OAUTH_GITHUB_CLIENT_ID: '',
  OAUTH_GITHUB_CLIENT_SECRET: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  EMAIL_DELIVERY_URL: '',
  EMAIL_DELIVERY_TOKEN: '',
  API_PROXY_TARGET: apiOrigin,
};
const frontendEnvironment = frontend === 'nextjs'
  ? { ...e2eEnvironment, NODE_ENV: 'production' }
  : e2eEnvironment;

function run(command, args, { cwd, env = e2eEnvironment } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(' ')} failed (code ${code ?? 'none'}, signal ${signal ?? 'none'}).`));
    });
  });
}

function start(command, args, { cwd, env = e2eEnvironment } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-8_000); });
  return { child, output: () => output };
}

async function waitFor(url, processInfo) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (processInfo.child.exitCode !== null) {
      throw new Error(`Process exited while waiting for ${url}:\n${processInfo.output()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The service is still booting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(`Timed out waiting for ${url}:\n${processInfo.output()}`);
}

async function stop(processInfo) {
  if (!processInfo || processInfo.child.exitCode !== null) return;
  processInfo.child.kill('SIGTERM');
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      if (processInfo.child.exitCode === null) processInfo.child.kill('SIGKILL');
      resolveStop();
    }, 5_000);
    processInfo.child.once('exit', () => { clearTimeout(timer); resolveStop(); });
  });
}

function setCookies(response, jar) {
  const getSetCookie = response.headers.getSetCookie?.bind(response.headers);
  const values = getSetCookie ? getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const [pair, ...attributes] = value.split(';').map((part) => part.trim());
    const [name, cookieValue] = pair.split('=', 2);
    if (attributes.some((attribute) => /^max-age=0$/i.test(attribute))) jar.delete(name);
    else jar.set(name, cookieValue);
  }
  return values;
}

function cookieHeader(jar) {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(path, init = {}) {
  return fetch(`${frontendOrigin}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { 'X-Request-ID': 'generated-project-e2e', ...init.headers },
  });
}

async function expectStatus(response, expected, description) {
  if (response.status !== expected) {
    assert.fail(`${description}: expected ${expected}, received ${response.status}: ${await response.text()}`);
  }
}

async function verifyBrowserSessionThroughProxy() {
  const credentials = { name: 'Generated Project', email: 'e2e@example.test', password: 'correct-horse-battery-staple' };
  const register = await request('/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
  });
  await expectStatus(register, 201, 'register failed');

  const login = await request('/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: credentials.email, password: credentials.password }),
  });
  await expectStatus(login, 200, 'login failed');
  const loginBody = await login.json();
  assert.equal(loginBody.user.email, credentials.email);
  assert.ok(loginBody.accessToken, 'login must return an access token in the response body.');
  const jar = new Map();
  const loginCookies = setCookies(login, jar);
  const refreshCookie = loginCookies.find((cookie) => cookie.startsWith('refresh_token='));
  const csrfCookie = loginCookies.find((cookie) => cookie.startsWith('csrf_token='));
  assert.match(refreshCookie ?? '', /;\s*HttpOnly(?:;|$)/i, 'the proxied refresh cookie must remain HttpOnly.');
  assert.match(refreshCookie ?? '', /;\s*Path=\/auth(?:;|$)/i, 'the proxied refresh cookie must remain scoped to /auth.');
  assert.doesNotMatch(csrfCookie ?? '', /;\s*HttpOnly(?:;|$)/i, 'the CSRF cookie must be readable by the frontend.');
  assert.ok(jar.get('refresh_token') && jar.get('csrf_token'), 'the same-origin proxy must preserve both session cookies.');

  const protectedWithoutToken = await request('/users/me');
  await expectStatus(protectedWithoutToken, 401, 'a protected route must reject an anonymous browser request');

  const currentUser = await request('/users/me', { headers: { Authorization: `Bearer ${loginBody.accessToken}` } });
  await expectStatus(currentUser, 200, 'the proxy must forward Authorization headers');
  assert.equal((await currentUser.json()).email, credentials.email);

  const csrf = jar.get('csrf_token');
  const refresh = await request('/auth/refresh', {
    method: 'POST', headers: { Cookie: cookieHeader(jar), 'X-CSRF-Token': csrf },
  });
  await expectStatus(refresh, 200, 'the proxy must forward Cookie and X-CSRF-Token headers');
  const refreshed = await refresh.json();
  assert.ok(refreshed.accessToken && refreshed.accessToken !== loginBody.accessToken, 'refresh must issue a new access token.');
  setCookies(refresh, jar);

  const preLogoutCookies = cookieHeader(jar);
  const preLogoutCsrf = jar.get('csrf_token');
  const logout = await request('/auth/logout', {
    method: 'POST', headers: { Cookie: preLogoutCookies, 'X-CSRF-Token': preLogoutCsrf },
  });
  await expectStatus(logout, 204, 'logout failed');
  setCookies(logout, jar);

  const refreshAfterLogout = await request('/auth/refresh', {
    method: 'POST', headers: { Cookie: preLogoutCookies, 'X-CSRF-Token': preLogoutCsrf },
  });
  await expectStatus(refreshAfterLogout, 401, 'logout must revoke the refresh session');
}

async function verifyExternalProvidersAreIsolated() {
  const oauth = backend === 'nestjs'
    ? await request('/auth/oauth/providers')
    : await request('/auth/oauth/google/start');
  if (backend === 'nestjs') {
    await expectStatus(oauth, 200, 'OAuth provider configuration failed');
    assert.ok((await oauth.json()).every((provider) => provider.configured === false), 'the controlled OAuth providers must remain disabled.');
  } else {
    await expectStatus(oauth, 404, 'the controlled OAuth provider must not redirect to a real service');
  }

  const stripe = await request('/billing/webhooks/stripe', { method: 'POST' });
  await expectStatus(stripe, 503, 'the controlled Stripe provider must fail closed instead of calling a real service');
}

let generatedRoot;
let generatedProject;
let api;
let web;
try {
  generatedRoot = await mkdtemp(join(tmpdir(), `create-my-saas-${backend}-${frontend}-`));
  generatedProject = join(generatedRoot, 'project');
  await run(process.execPath, [join(root, 'packages/cli/bin/create-my-saas.js'), generatedProject, '--backend', backend, '--frontend', frontend], { cwd: root });

  const backendDirectory = join(generatedProject, 'backend');
  const frontendDirectory = join(generatedProject, 'frontend');
  if (backend === 'fastapi') {
    await run('uv', ['sync', '--locked'], { cwd: backendDirectory });
    await run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: backendDirectory });
    api = start('uv', ['run', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(apiPort)], { cwd: backendDirectory });
    await waitFor(`${apiOrigin}/health`, api);
  } else {
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: backendDirectory });
    await run('pnpm', ['run', 'migration:run'], { cwd: backendDirectory });
    await run('pnpm', ['run', 'build'], { cwd: backendDirectory });
    api = start('node', ['dist/main'], { cwd: backendDirectory });
    await waitFor(`${apiOrigin}/`, api);
  }

  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: frontendDirectory });
  await run('pnpm', ['run', 'build'], { cwd: frontendDirectory, env: frontendEnvironment });
  web = frontend === 'astro'
    ? start('pnpm', ['exec', 'astro', 'dev', '--host', '127.0.0.1', '--port', String(frontendPort)], { cwd: frontendDirectory, env: { ...frontendEnvironment, PORT: String(frontendPort) } })
    : start('pnpm', ['run', 'start'], { cwd: frontendDirectory, env: { ...frontendEnvironment, PORT: String(frontendPort) } });
  await waitFor(`${frontendOrigin}/`, web);
  await verifyExternalProvidersAreIsolated();
  await verifyBrowserSessionThroughProxy();
  console.log(`Generated ${backend} + ${frontend} HTTP session contract E2E passed.`);
} finally {
  await stop(web);
  await stop(api);
  if (generatedRoot) await rm(generatedRoot, { recursive: true, force: true });
}
