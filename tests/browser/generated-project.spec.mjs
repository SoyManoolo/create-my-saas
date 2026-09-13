import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const backend = process.env.E2E_BACKEND ?? 'fastapi';
const frontend = process.env.E2E_FRONTEND ?? 'nextjs';
const supportedCombinations = new Set(['fastapi:nextjs', 'nestjs:react-router', 'fastify:astro']);

if (!supportedCombinations.has(`${backend}:${frontend}`)) {
  throw new Error('Set E2E_BACKEND/E2E_FRONTEND to fastapi/nextjs, nestjs/react-router, or fastify/astro.');
}

const apiPort = { fastapi: 8000, nestjs: 3001, fastify: 3002 }[backend];
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const frontendOrigin = 'http://127.0.0.1:3100';
const paths = {
  nextjs: { protected: '/', login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' },
  'react-router': { protected: '/app', login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' },
  astro: { protected: '/app/', login: '/login/', register: '/register/', forgot: '/forgot-password/', reset: '/reset-password/' },
}[frontend];
const hasBilling = frontend !== 'astro';
const e2eEnvironment = Object.fromEntries(Object.entries({
  ...process.env,
  APP_ENV: 'development',
  NODE_ENV: 'development',
  PORT: String(apiPort),
  DATABASE_URL: backend === 'fastapi'
    ? 'postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/app'
    : 'postgresql://postgres:postgres@127.0.0.1:5432/app',
  REDIS_URL: 'redis://127.0.0.1:6379',
  SECRET_KEY: 'generated-browser-e2e-secret-that-is-long-enough-to-be-safe',
  FRONTEND_URL: frontendOrigin,
  CORS_ORIGINS: frontendOrigin,
  PUBLIC_SITE_URL: frontendOrigin,
  COOKIE_SECURE: 'false',
  COOKIE_SAME_SITE: 'lax',
  RATE_LIMIT_ENABLED: 'true',
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
}).filter(([, value]) => value !== ''));

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
  child.stdout.on('data', (chunk) => { output = `${output}${chunk}`.slice(-10_000); });
  child.stderr.on('data', (chunk) => { output = `${output}${chunk}`.slice(-10_000); });
  return { child, output: () => output };
}

async function waitFor(url, processInfo) {
  for (let attempt = 0; attempt < 180; attempt += 1) {
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

function isApiResponse(response, path) {
  return new URL(response.url()).pathname.replace(/\/$/, '') === path.replace(/\/$/, '');
}

function normalisePath(path) {
  return path === '/' ? path : path.replace(/\/$/, '');
}

async function expectPath(page, path) {
  await expect.poll(() => normalisePath(new URL(page.url()).pathname)).toBe(normalisePath(path));
}

async function waitForApi(page, path, action) {
  const responsePromise = page.waitForResponse((response) => isApiResponse(response, path));
  await action();
  return responsePromise;
}

let generatedRoot;
let generatedProject;
let api;
let web;

test.beforeAll(async () => {
  test.setTimeout(15 * 60 * 1_000);
  generatedRoot = await mkdtemp(join(tmpdir(), `create-my-saas-browser-${backend}-${frontend}-`));
  generatedProject = join(generatedRoot, 'project');
  await run(process.execPath, [
    join(root, 'packages/cli/bin/create-my-saas.js'), generatedProject,
    '--backend', backend, '--frontend', frontend,
  ], { cwd: root });

  const backendDirectory = join(generatedProject, 'backend');
  const frontendDirectory = join(generatedProject, 'frontend');
  if (backend === 'fastapi') {
    await run('uv', ['sync', '--locked'], { cwd: backendDirectory });
    await run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: backendDirectory });
    api = start('uv', ['run', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(apiPort)], { cwd: backendDirectory });
    await waitFor(`${apiOrigin}/health`, api);
  } else {
    await run('pnpm', ['install', '--frozen-lockfile'], { cwd: backendDirectory });
    await run('pnpm', ['run', backend === 'nestjs' ? 'migration:run' : 'db:migrate'], { cwd: backendDirectory });
    await run('pnpm', ['run', 'build'], { cwd: backendDirectory });
    api = start('node', [backend === 'nestjs' ? 'dist/main' : 'dist/server.js'], { cwd: backendDirectory });
    await waitFor(`${apiOrigin}/${backend === 'nestjs' ? '' : 'health'}`, api);
  }

  await run('pnpm', ['install', '--frozen-lockfile'], { cwd: frontendDirectory });
  await run('pnpm', ['run', 'build'], { cwd: frontendDirectory });
  web = frontend === 'astro'
    ? start('pnpm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '3100'], { cwd: frontendDirectory, env: { ...e2eEnvironment, PORT: '3100' } })
    : start('pnpm', ['run', 'start'], { cwd: frontendDirectory, env: { ...e2eEnvironment, PORT: '3100' } });
  await waitFor(`${frontendOrigin}/`, web);
});

test.afterAll(async () => {
  test.setTimeout(30_000);
  await stop(web);
  await stop(api);
  if (generatedRoot) await rm(generatedRoot, { recursive: true, force: true });
});

test(`${backend} + ${frontend} exercises the generated UI in Chromium`, async ({ page, context }) => {
  const browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) browserErrors.push(message.text());
  });

  await test.step('anonymous users are redirected from protected content', async () => {
    await page.goto(paths.protected);
    await expectPath(page, paths.login);
    await expect(page.getByRole('heading', { name: /Inicia sesión|Bienvenido de nuevo/i })).toBeVisible();
  });

  if (backend !== 'fastapi') {
    await test.step('unconfigured OAuth is reported in the DOM', async () => {
      const providers = await waitForApi(page, '/auth/oauth/providers', () => page.getByRole('button', { name: 'Google' }).click());
      expect(providers.status()).toBe(200);
      const oauthStatus = frontend === 'astro' ? page.locator('[data-oauth-status]') : page.getByRole('alert');
      await expect(oauthStatus).toContainText(/OAuth no está configurado/i);
      await expectPath(page, paths.login);
    });
  }

  const unique = `${backend}-${frontend}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const credentials = { name: 'Browser E2E', email: `${unique}@example.test`, password: 'browser-password-123' };

  await test.step('registration submits the real form and follows its UI transition', async () => {
    await page.goto(paths.register);
    await page.locator('input[name="name"]').fill(credentials.name);
    await page.locator('input[name="email"]').fill(credentials.email);
    await page.locator('input[name="password"]').fill(credentials.password);
    const response = await waitForApi(page, '/auth/register', () => page.getByRole('button', { name: 'Crear cuenta' }).click());
    expect(response.status()).toBe(201);
    if (frontend === 'nextjs') {
      await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible();
      await page.getByRole('link', { name: 'Ir a iniciar sesión' }).click();
    } else if (frontend === 'react-router') {
      await expect(page).toHaveURL(/\/login\?registered=1$/);
    } else {
      await expect(page.locator('[data-form-status]')).toContainText(/Revisa tu correo/i);
      await page.getByRole('link', { name: 'Iniciar sesión' }).click();
    }
    await expectPath(page, paths.login);
  });

  await test.step('password recovery submits and invalid reset links fail in the UI', async () => {
    await page.locator('a[href^="/forgot-password"]').click();
    await expectPath(page, paths.forgot);
    await page.locator('input[name="email"]').fill(credentials.email);
    const response = await waitForApi(page, '/auth/password/reset/request', () => page.locator('button[type="submit"]').click());
    expect(response.ok()).toBe(true);
    await expect(page.getByText(/Si existe una cuenta con ese (correo|email)/i)).toBeVisible();

    await page.goto(paths.reset);
    if (frontend === 'nextjs') {
      await expect(page.getByRole('button', { name: 'Actualizar contraseña' })).toBeDisabled();
    } else if (frontend === 'react-router') {
      await expect(page.getByRole('alert')).toContainText(/token de recuperación válido/i);
    } else {
      await page.locator('input[name="password"]').fill('replacement-password-456');
      await page.getByRole('button', { name: 'Actualizar contraseña' }).click();
      await expect(page.locator('[data-form-status]')).toContainText(/no es válido/i);
    }
  });

  await test.step('login redirects and the session survives a full reload', async () => {
    await page.goto(paths.login);
    await page.locator('input[name="email"]').fill(credentials.email);
    await page.locator('input[name="password"]').fill('not-the-right-password');
    const rejectedLogin = await waitForApi(page, '/auth/login', () => page.getByRole('button', { name: /Iniciar sesión|Entrar/i }).click());
    expect(rejectedLogin.status()).toBe(401);
    const loginStatus = frontend === 'astro' ? page.locator('[data-form-status]') : page.getByRole('alert');
    await expect(loginStatus).toHaveText('El correo o la contraseña no son correctos.');
    await expect(loginStatus).not.toContainText('incorrect');

    await page.locator('input[name="password"]').fill(credentials.password);
    const login = await waitForApi(page, '/auth/login', () => page.getByRole('button', { name: /Iniciar sesión|Entrar/i }).click());
    expect(login.status()).toBe(200);
    await expectPath(page, paths.protected);
    await expect(page.getByRole('heading', { name: /Tu base de producto/i })).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === 'refresh_token')).toMatchObject({ httpOnly: true, path: '/auth' });
    expect(cookies.find((cookie) => cookie.name === 'csrf_token')?.httpOnly).toBe(false);

    const refresh = page.waitForResponse((response) => isApiResponse(response, '/auth/refresh') && response.status() === 200);
    await page.reload();
    await refresh;
    await expect(page.getByRole('heading', { name: /Tu base de producto/i })).toBeVisible();
  });

  if (hasBilling) {
    await test.step('billing navigation renders the explicit unconfigured state', async () => {
      await page.getByRole('link', { name: 'Facturación' }).click();
      await expectPath(page, '/billing');
      await expect(page.getByRole('heading', { name: 'Planes y suscripción' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Facturación no configurada' })).toBeVisible();
    });
  }

  await test.step('logout revokes the browser session and protects the route again', async () => {
    const logout = await waitForApi(page, '/auth/logout', () => page.getByRole('button', { name: /Cerrar sesión|Salir/i }).click());
    expect(logout.status()).toBe(204);
    await expectPath(page, paths.login);
    expect((await context.cookies()).some((cookie) => cookie.name === 'refresh_token')).toBe(false);
    await page.goto(paths.protected);
    await expectPath(page, paths.login);
  });

  expect(browserErrors, `Browser errors:\n${browserErrors.join('\n')}`).toEqual([]);
});
