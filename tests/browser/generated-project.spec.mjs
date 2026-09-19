import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const backend = process.env.E2E_BACKEND ?? 'fastapi';
const frontend = process.env.E2E_FRONTEND ?? 'nextjs';
const featureIds = (process.env.E2E_FEATURES ?? '').split(',').map((feature) => feature.trim()).filter(Boolean);
const featureKey = featureIds.slice().sort().join(',');
const supportedCombinations = new Set([
  'fastapi:nextjs:', 'fastapi:react-router:', 'fastapi:astro:', 'fastapi:astro:billing',
  'nestjs:nextjs:', 'nestjs:react-router:', 'nestjs:astro:', 'nestjs:astro:billing',
  'fastify:astro:',
]);

if (!supportedCombinations.has(`${backend}:${frontend}:${featureKey}`)) {
  throw new Error('Set E2E_BACKEND/E2E_FRONTEND/E2E_FEATURES to a compatible generated project combination. Astro billing requires E2E_FEATURES=billing with FastAPI or NestJS.');
}

const apiPort = { fastapi: 8000, nestjs: 3001, fastify: 3002 }[backend];
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const frontendOrigin = 'http://127.0.0.1:3100';
const paths = {
  nextjs: { protected: '/', login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' },
  'react-router': { protected: '/app', login: '/login', register: '/register', forgot: '/forgot-password', reset: '/reset-password' },
  astro: { protected: '/app/', login: '/login/', register: '/register/', forgot: '/forgot-password/', reset: '/reset-password/' },
}[frontend];
// Astro deliberately exposes the organization proxy only when its billing
// overlay is selected. The base site stays compatible with Fastify.
const hasOrganizations = frontend !== 'astro' || featureIds.includes('billing');
const hasBilling = frontend !== 'astro' || featureIds.includes('billing');
const runKey = `${backend}-${frontend}${featureKey ? `-${featureKey.replaceAll(',', '-')}` : ''}`;
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
  RATE_LIMIT_PREFIX: `generated-browser-e2e-${runKey}`,
  OAUTH_ENABLED: 'false',
  OAUTH_GOOGLE_CLIENT_ID: '',
  OAUTH_GOOGLE_CLIENT_SECRET: '',
  OAUTH_GITHUB_CLIENT_ID: '',
  OAUTH_GITHUB_CLIENT_SECRET: '',
  STRIPE_SECRET_KEY: '',
  STRIPE_WEBHOOK_SECRET: '',
  EMAIL_DELIVERY_URL: '',
  EMAIL_DELIVERY_TOKEN: 'generated-browser-e2e-email-token',
  API_PROXY_TARGET: apiOrigin,
}).filter(([, value]) => value !== ''));
const frontendEnvironment = frontend === 'nextjs'
  ? { ...e2eEnvironment, NODE_ENV: 'production' }
  : frontend === 'astro'
    ? { ...e2eEnvironment, PUBLIC_API_BASE_URL: apiOrigin }
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
  const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
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
  if (!processInfo) return;
  const terminate = (signal) => {
    if (process.platform !== 'win32' && processInfo.child.pid) {
      try { process.kill(-processInfo.child.pid, signal); return; } catch { /* Process group already exited. */ }
    }
    if (processInfo.child.exitCode === null) processInfo.child.kill(signal);
  };
  terminate('SIGTERM');
  if (processInfo.child.exitCode !== null) return;
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      terminate('SIGKILL');
      resolveStop();
    }, 5_000);
    processInfo.child.once('exit', () => { clearTimeout(timer); resolveStop(); });
  });
}

async function removeTemporaryDirectory(directory) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(directory, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'ENOTEMPTY' || attempt === 2) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
}

function isApiResponse(response, path) {
  return new URL(response.url()).pathname.replace(/\/$/, '') === path.replace(/\/$/, '');
}

function normalisePath(path) {
  return path === '/' ? path : path.replace(/\/$/, '');
}

function apiPath(path) {
  return path.startsWith('/') ? path : `/${path}`;
}

function billingPath(organizationId, action) {
  if (backend === 'fastapi') {
    return `/billing/organizations/${organizationId}${action === 'subscription' ? '' : `/${action}`}`;
  }
  return `/organizations/${organizationId}/billing/${action}`;
}

async function browserApi(page, path, { method = 'GET', body, accessToken } = {}) {
  return page.evaluate(async ({ requestPath, requestMethod, requestBody, token }) => {
    const csrf = document.cookie.split(';').map((value) => value.trim().split('=', 2)).find(([name]) => name === 'csrf_token')?.[1];
    const headers = new Headers();
    if (requestBody !== undefined) headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (csrf && !['GET', 'HEAD', 'OPTIONS'].includes(requestMethod)) headers.set('x-csrf-token', csrf);
    const response = await fetch(requestPath, { method: requestMethod, headers, credentials: 'include', body: requestBody === undefined ? undefined : JSON.stringify(requestBody) });
    const responseBody = await response.json().catch(() => undefined);
    return { status: response.status, body: responseBody };
  }, { requestPath: apiPath(path), requestMethod: method, requestBody: body, token: accessToken });
}

function startMailbox() {
  const messages = [];
  const server = createServer(async (request, response) => {
    let content = '';
    for await (const chunk of request) content += chunk;
    if (request.method !== 'POST' || request.headers.authorization !== 'Bearer generated-browser-e2e-email-token') {
      response.writeHead(401).end();
      return;
    }
    try {
      messages.push(JSON.parse(content));
      response.writeHead(204).end();
    } catch {
      response.writeHead(400).end();
    }
  });
  return new Promise((resolveMailbox) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolveMailbox({
        url: `http://127.0.0.1:${address.port}`,
        messages,
        close: () => new Promise((resolveClose) => server.close(resolveClose)),
      });
    });
  });
}

async function invitationToken(mailbox, email) {
  await expect.poll(() => mailbox.messages.find((message) => message.to === email && /organization invitation/i.test(message.subject ?? ''))?.text).toMatch(/token:/i);
  const message = mailbox.messages.find((candidate) => candidate.to === email && /organization invitation/i.test(candidate.subject ?? ''));
  const token = message?.text?.match(/token:\s*([^\s]+)/i)?.[1];
  expect(token, 'The invitation email must contain its one-time token.').toBeTruthy();
  return token;
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
let mailbox;

test.beforeAll(async () => {
  test.setTimeout(15 * 60 * 1_000);
  generatedRoot = await mkdtemp(join(tmpdir(), `create-my-saas-browser-${backend}-${frontend}-`));
  generatedProject = join(generatedRoot, 'project');
  mailbox = await startMailbox();
  e2eEnvironment.EMAIL_DELIVERY_URL = mailbox.url;
  await run(process.execPath, [
    join(root, 'packages/cli/bin/create-my-saas.js'), generatedProject,
    '--backend', backend, '--frontend', frontend,
    ...featureIds.flatMap((feature) => ['--feature', feature]),
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
  await run('pnpm', ['run', 'build'], { cwd: frontendDirectory, env: frontendEnvironment });
  web = frontend === 'astro'
    ? start('pnpm', ['exec', 'astro', 'dev', '--host', '127.0.0.1', '--port', '3100'], { cwd: frontendDirectory, env: { ...frontendEnvironment, PORT: '3100' } })
    : start('pnpm', ['run', 'start'], { cwd: frontendDirectory, env: { ...frontendEnvironment, PORT: '3100' } });
  await waitFor(`${frontendOrigin}/`, web);
});

test.afterAll(async () => {
  test.setTimeout(30_000);
  await stop(web);
  await stop(api);
  await mailbox?.close();
  if (generatedRoot) await removeTemporaryDirectory(generatedRoot);
});

test(`${backend} + ${frontend}${featureKey ? ` + ${featureKey}` : ''} exercises the generated UI in Chromium`, async ({ page, context, browser }) => {
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
  const credentials = { name: 'Browser E2E', email: `${unique}@example.com`, password: 'browser-password-123' };
  let ownerSession;
  let organization;

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
    const response = await waitForApi(page, '/auth/password/reset/request', () => page.getByRole('button', { name: /Enviar (enlace|instrucciones)/i }).click());
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
    const loginStatus = frontend === 'astro' ? page.locator('[data-form-status]') : page.locator('form [role="alert"]');
    await expect(loginStatus).toHaveText('El correo o la contraseña no son correctos.');
    await expect(loginStatus).not.toContainText('incorrect');

    await page.locator('input[name="password"]').fill(credentials.password);
    const login = await waitForApi(page, '/auth/login', () => page.getByRole('button', { name: /Iniciar sesión|Entrar/i }).click());
    expect(login.status()).toBe(200);
    ownerSession = await login.json();
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

  if (hasOrganizations) {
    await test.step('organizations, invitations, and organization permissions use the generated proxy', async () => {
      const created = await browserApi(page, '/organizations', {
        method: 'POST',
        accessToken: ownerSession.accessToken ?? ownerSession.access_token,
        body: { name: `Browser organization ${unique}`, slug: `browser-org-${unique}`.replaceAll(/[^a-z0-9-]/g, '-').slice(0, 150) },
      });
      expect(created.status).toBe(201);
      organization = created.body;
      expect(organization).toMatchObject({ name: `Browser organization ${unique}` });

      const listed = await browserApi(page, '/organizations', { accessToken: ownerSession.accessToken ?? ownerSession.access_token });
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: organization.id })]));

      const inviteeContext = await browser.newContext({ baseURL: frontendOrigin });
      const inviteePage = await inviteeContext.newPage();
      await inviteePage.goto(paths.login);
      const invitee = { name: 'Invited browser user', email: `invitee-${unique}@example.com`, password: 'invitee-password-123' };
      const registeredInvitee = await browserApi(inviteePage, '/auth/register', { method: 'POST', body: invitee });
      expect(registeredInvitee.status).toBe(201);
      const inviteeLogin = await browserApi(inviteePage, '/auth/login', {
        method: 'POST', body: { email: invitee.email, password: invitee.password },
      });
      expect(inviteeLogin.status).toBe(200);
      const inviteeSession = inviteeLogin.body;

      const invitation = await browserApi(page, `/organizations/${organization.id}/invitations`, {
        method: 'POST', accessToken: ownerSession.accessToken ?? ownerSession.access_token,
        body: { email: invitee.email, role: 'member' },
      });
      expect(invitation.status).toBe(backend === 'fastapi' ? 201 : 204);
      const token = await invitationToken(mailbox, invitee.email);

      const accepted = await browserApi(inviteePage, '/organizations/invitations/accept', {
        method: 'POST', accessToken: inviteeSession.accessToken ?? inviteeSession.access_token, body: { token },
      });
      expect(accepted.status).toBe(backend === 'fastapi' ? 204 : 201);

      const members = await browserApi(page, `/organizations/${organization.id}/members`, {
        accessToken: ownerSession.accessToken ?? ownerSession.access_token,
      });
      expect(members.status).toBe(200);
      const invitedMember = members.body.find((member) => (
        backend === 'fastapi'
          ? member.email === invitee.email
          : member.userId === inviteeSession.user.id
      ));
      expect(invitedMember).toBeTruthy();

      const deniedBilling = await browserApi(inviteePage, billingPath(organization.id, 'configuration'), {
        accessToken: inviteeSession.accessToken ?? inviteeSession.access_token,
      });
      expect(deniedBilling.status).toBe(403);

      const memberId = backend === 'fastapi' ? invitedMember.id : invitedMember.userId;
      expect(memberId, 'Membership list must expose the identifier required by its role endpoint.').toBeTruthy();
      const promoted = await browserApi(page, `/organizations/${organization.id}/members/${memberId}`, {
        method: 'PATCH', accessToken: ownerSession.accessToken ?? ownerSession.access_token, body: { role: 'admin' },
      });
      expect(promoted.status).toBe(204);

      const allowedBilling = await browserApi(inviteePage, billingPath(organization.id, 'configuration'), {
        accessToken: inviteeSession.accessToken ?? inviteeSession.access_token,
      });
      expect(allowedBilling.status).toBe(200);
      expect(allowedBilling.body).toMatchObject({ configured: false, provider: 'stripe' });
      await inviteeContext.close();
    });
  }

  if (hasBilling) {
    await test.step('billing navigation renders the explicit unconfigured state', async () => {
      expect(organization, 'Billing-capable generated frontends require an organization-capable backend.').toBeTruthy();
      const configuration = await browserApi(page, billingPath(organization.id, 'configuration'), {
        accessToken: ownerSession.accessToken ?? ownerSession.access_token,
      });
      expect(configuration).toMatchObject({ status: 200, body: { configured: false, provider: 'stripe' } });
      const checkout = await browserApi(page, billingPath(organization.id, 'checkout'), {
        method: 'POST', accessToken: ownerSession.accessToken ?? ownerSession.access_token, body: { priceId: 'price_browser_e2e', quantity: 1 },
      });
      expect(checkout).toMatchObject({ status: 200, body: { configured: false, url: null } });

      await page.getByRole('link', { name: 'Facturación' }).click();
      await expectPath(page, frontend === 'astro' ? '/billing/' : '/billing');
      await expect(page.getByRole('heading', { name: 'Planes y suscripción' })).toBeVisible();
      if (frontend === 'astro') {
        await expect(page.locator('[data-billing-summary]')).toContainText(/Plan actual: free · active/i);
        await expect(page.locator('[data-billing-status]')).toContainText(/Configura Stripe/i);
        await expect(page.getByRole('button', { name: 'Gestionar suscripción' })).toBeDisabled();
      } else {
        await expect(page.getByRole('heading', { name: 'Facturación no configurada' })).toBeVisible();
      }
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
