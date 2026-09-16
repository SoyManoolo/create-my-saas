import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApplication } from './../src/app.setup';
import { SecureEmailService } from './../src/auth/secure-email.service';
import { createHash, randomUUID } from 'node:crypto';
import { AuthService } from '../src/auth/auth.service';
import { OAuthAccount } from '../src/auth/oauth-account.entity';
import { OAuthState } from '../src/auth/oauth-state.entity';
import { UsersService } from '../src/users/users.service';
import { User } from '../src/users/user.entity';
import { BillingCustomer } from '../src/billing/billing-customer.entity';
import { BillingWebhookEvent } from '../src/billing/billing-webhook-event.entity';
import Stripe from 'stripe';
import { jest } from '@jest/globals';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let deliveries: Array<{ recipient: string; subject: string; text: string }>;

  beforeEach(async () => {
    deliveries = [];
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SecureEmailService)
      .useValue({
        send: async (recipient: string, subject: string, text: string) => {
          deliveries.push({ recipient, subject, text });
        },
      })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    configureApplication(app);
    await app.init();
    await resetDatabase(app.get(DataSource));

    if (process.env.POSTGRES_INTEGRATION_TESTS === '1') {
      expect(app.get(DataSource).options.type).toBe('postgres');
    }
  });

  it('/ (GET)', async () => {
    const response = await request(app.getHttpServer()).get('/').expect(200);
    expect(response.body).toEqual({ message: 'Running successfully!' });
    expect(response.headers['x-request-id']).toBeDefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('uses stricter independent buckets for sensitive authentication routes', async () => {
    const config = app.get(ConfigService);
    config.set('RATE_LIMIT_ENABLED', true);
    config.set('RATE_LIMIT_REQUESTS', 30);
    config.set('RATE_LIMIT_WINDOW_SECONDS', 60);
    config.set('AUTH_RATE_LIMIT_REQUESTS', 1);
    config.set('AUTH_RATE_LIMIT_WINDOW_SECONDS', 120);

    await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(403);
    await request(app.getHttpServer()).post('/auth/refresh').send({}).expect(403);

    for (const path of [
      '/auth/register',
      '/auth/login',
      '/auth/password/reset/request',
      '/auth/password/reset/confirm',
    ]) {
      await request(app.getHttpServer()).post(path).send({}).expect(400);
      const limited = await request(app.getHttpServer()).post(path).send({}).expect(429);
      expect(limited.headers['retry-after']).toBe('120');
      expect(limited.body.error.code).toBe('RATE_LIMITED');
    }
  });

  it('registers, authenticates and returns the current user', async () => {
    const registration = {
      email: 'person@example.com',
      password: 'password123',
      name: 'Person Example',
    };

    const registerResponse = await request(app.getHttpServer())
      .post('/auth/register')
      .send(registration)
      .expect(201);

    expect(registerResponse.body).toMatchObject({
      email: registration.email,
      name: registration.name,
      emailVerified: false,
      isActive: true,
    });
    expect(registerResponse.body.passwordHash).toBeUndefined();

    const loginResponse = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registration.email, password: registration.password })
      .expect(200);

    expect(loginResponse.body.accessToken).toEqual(expect.any(String));
    expect(loginResponse.body.refreshToken).toBeUndefined();
    expect(loginResponse.headers['cache-control']).toBe('no-store');
    expect(loginResponse.headers.pragma).toBe('no-cache');
    const cookieHeader = loginResponse.headers['set-cookie'];
    const cookies = Array.isArray(cookieHeader) ? cookieHeader : cookieHeader ? [cookieHeader] : [];
    expect(cookies.find((cookie) => cookie.startsWith('refresh_token='))).toMatch(/(?:^|;\s*)Path=\/auth(?:;|$)/);
    expect(cookies.find((cookie) => cookie.startsWith('refresh_token='))).toMatch(/HttpOnly/);
    expect(cookies.find((cookie) => cookie.startsWith('refresh_token='))).toMatch(/SameSite=Lax/);
    expect(cookies.find((cookie) => cookie.startsWith('csrf_token='))).toMatch(/(?:^|;\s*)Path=\/(?:;|$)/);
    expect(cookies.find((cookie) => cookie.startsWith('csrf_token='))).not.toMatch(/HttpOnly/);

    return request(app.getHttpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${loginResponse.body.accessToken}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.email).toBe(registration.email);
        expect(body.passwordHash).toBeUndefined();
      });
  });

  it('rejects duplicate registration and invalid credentials with the API error shape', async () => {
    const registration = {
      email: 'duplicate@example.com',
      password: 'password123',
      name: 'Duplicate',
    };
    await request(app.getHttpServer()).post('/auth/register').send(registration).expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(registration)
      .expect(409)
      .expect({
        error: {
          code: 'EMAIL_ALREADY_EXISTS',
          message: 'An account with this email already exists.',
        },
      });

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: registration.email, password: 'wrong-password' })
      .expect(401)
      .expect({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'The email or password is incorrect.',
        },
      });
  });

  it('uses the shared password policy and requires CSRF for cookie-session mutations', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({ email: 'weak@example.com', password: 'onlyletters', name: 'Weak' }).expect(400);
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/register').send({ email: 'csrf@example.com', password: 'password-with-number1', name: 'CSRF' }).expect(201);
    await agent.post('/auth/login').send({ email: 'csrf@example.com', password: 'password-with-number1' }).expect(200);
    await agent.post('/auth/refresh').expect(403).expect({ error: { code: 'INVALID_CSRF_TOKEN', message: 'CSRF token is missing or invalid.' } });
    await agent.post('/auth/logout').expect(403).expect({ error: { code: 'INVALID_CSRF_TOKEN', message: 'CSRF token is missing or invalid.' } });
  });

  it('does not reflect submitted credentials in validation errors', async () => {
    const password = 'secret-password1';
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password })
      .expect(400);

    expect(JSON.stringify(response.body)).not.toContain(password);
  });

  it('rotates refresh credentials and revokes every session when a rotated credential is reused', async () => {
    const credentials = { email: 'rotation@example.com', password: 'password123', name: 'Rotation' };
    await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').send(loginPayload(credentials)).expect(200);
    const first = cookieValues(login);

    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', first.header)
      .set('X-CSRF-Token', first.csrf)
      .expect(200);
    const second = cookieValues(rotated);
    expect(second.refresh).not.toBe(first.refresh);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', first.header)
      .set('X-CSRF-Token', first.csrf)
      .expect(401)
      .expect({ error: { code: 'REFRESH_TOKEN_REUSED', message: 'The refresh token was already used; all sessions were revoked.' } });

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', second.header)
      .set('X-CSRF-Token', second.csrf)
      .expect(401)
      .expect({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'The refresh token is invalid or expired.' } });
  });

  it('keeps reset delivery indistinguishable and consumes verification and reset tokens exactly once', async () => {
    const credentials = { email: 'recovery@example.com', password: 'password123', name: 'Recovery' };
    const registration = await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    const verificationToken = tokenFrom(deliveries.at(-1)?.text);
    expect(JSON.stringify(registration.body)).not.toContain(verificationToken);

    await request(app.getHttpServer()).post('/auth/email/verify').send({ token: verificationToken }).expect(204);
    await request(app.getHttpServer())
      .post('/auth/email/verify')
      .send({ token: verificationToken })
      .expect(400)
      .expect({ error: { code: 'INVALID_TOKEN', message: 'The token is invalid or expired.' } });

    await request(app.getHttpServer()).post('/auth/password/reset/request').send({ email: credentials.email }).expect(204);
    const resetToken = tokenFrom(deliveries.at(-1)?.text);
    await request(app.getHttpServer()).post('/auth/password/reset/request').send({ email: 'missing@example.com' }).expect(204);
    expect(deliveries).toHaveLength(2);

    await request(app.getHttpServer()).post('/auth/password/reset/confirm').send({ token: resetToken, newPassword: 'new-password1' }).expect(204);
    await request(app.getHttpServer())
      .post('/auth/password/reset/confirm')
      .send({ token: resetToken, newPassword: 'new-password1' })
      .expect(400)
      .expect({ error: { code: 'INVALID_TOKEN', message: 'The token is invalid or expired.' } });
    await request(app.getHttpServer()).post('/auth/login').send(loginPayload(credentials)).expect(401);
    await request(app.getHttpServer()).post('/auth/login').send({ ...loginPayload(credentials), password: 'new-password1' }).expect(200);
  });

  it('only advertises Google and GitHub OAuth when fully configured', async () => {
    await request(app.getHttpServer()).get('/auth/oauth/providers').expect(200).expect([
      { provider: 'google', configured: false },
      { provider: 'github', configured: false },
    ]);
  });

  it('exchanges PKCE state once, persists provider subjects, and rejects identity conflicts', async () => {
    const config = app.get(ConfigService);
    const auth = app.get(AuthService);
    const database = app.get(DataSource);
    config.set('OAUTH_ENABLED', true);
    config.set('OAUTH_GOOGLE_CLIENT_ID', 'google-client');
    config.set('OAUTH_GOOGLE_CLIENT_SECRET', 'google-secret');
    config.set('OAUTH_GOOGLE_REDIRECT_URI', 'http://localhost:3001/auth/oauth/google/callback');
    const originalFetch = globalThis.fetch;
    const requests: RequestInit[] = [];
    try {
      const start = await auth.oauthStart('google');
      const url = new URL(start.authorizationUrl);
      const state = url.searchParams.get('state')!;
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      const stateRecord = (await database.getRepository(OAuthState).find()).at(-1);
      expect(stateRecord).toBeDefined();
      globalThis.fetch = (async (_input, init) => {
        requests.push(init!);
        if (init?.method === 'POST') return { ok: true, json: async () => ({ access_token: 'provider-token' }) } as Response;
        return { ok: true, json: async () => ({ sub: 'google-subject-1', email: 'person@example.com', email_verified: true, name: 'Person' }) } as Response;
      }) as typeof fetch;
      const result = await auth.oauthCallback('google', state, 'code');
      expect(result.refreshToken).toEqual(expect.any(String));
      expect((requests[0]?.body as URLSearchParams).get('code_verifier')).toBe(stateRecord!.codeVerifier);
      const account = await database.getRepository(OAuthAccount).findOneByOrFail({ provider: 'google', providerAccountId: 'google-subject-1' });
      expect(account.userId).toBe(result.authentication.user.id);
      await expect(auth.oauthCallback('google', state, 'code')).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });

      await request(app.getHttpServer()).post('/auth/register').send({ email: 'other@example.com', password: 'password123', name: 'Other' }).expect(201);
      const conflictState = new URL((await auth.oauthStart('google')).authorizationUrl).searchParams.get('state')!;
      globalThis.fetch = (async (_input, init) => {
        if (init?.method === 'POST') return { ok: true, json: async () => ({ access_token: 'provider-token' }) } as Response;
        return { ok: true, json: async () => ({ sub: 'google-subject-1', email: 'other@example.com', email_verified: true, name: 'Other' }) } as Response;
      }) as typeof fetch;
      await expect(auth.oauthCallback('google', conflictState, 'code')).rejects.toMatchObject({ code: 'OAUTH_ACCOUNT_CONFLICT' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('atomically rotates a refresh credential under concurrent replay attempts', async () => {
    const credentials = { email: 'refresh-race@example.com', password: 'password123', name: 'Refresh race' };
    await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    const login = await request(app.getHttpServer()).post('/auth/login').send(loginPayload(credentials)).expect(200);
    const original = cookieValues(login);

    const attempts = await Promise.all([
      request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original.header).set('X-CSRF-Token', original.csrf),
      request(app.getHttpServer()).post('/auth/refresh').set('Cookie', original.header).set('X-CSRF-Token', original.csrf),
    ]);
    expect(attempts.map((attempt) => attempt.status).sort()).toEqual([200, 401]);
    const winner = attempts.find((attempt) => attempt.status === 200);
    if (!winner) throw new Error('One concurrent refresh attempt must rotate the session.');
    const replacement = cookieValues(winner);

    // The losing claim revokes all active sessions, including the token the
    // winner just issued. A captured refresh cookie therefore cannot survive
    // a replay race.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', replacement.header)
      .set('X-CSRF-Token', replacement.csrf)
      .expect(401);
  });

  it('persists an S256 PKCE state in PostgreSQL and permits exactly one OAuth callback', async () => {
    const config = app.get(ConfigService);
    config.set('OAUTH_ENABLED', true);
    config.set('OAUTH_GOOGLE_CLIENT_ID', 'e2e-google-client');
    config.set('OAUTH_GOOGLE_CLIENT_SECRET', 'e2e-google-secret');
    config.set('OAUTH_GOOGLE_AUTHORIZATION_URL', 'https://oauth.test/authorize');
    config.set('OAUTH_GOOGLE_TOKEN_URL', 'https://oauth.test/token');
    config.set('OAUTH_GOOGLE_USERINFO_URL', 'https://oauth.test/userinfo');
    config.set('OAUTH_GOOGLE_REDIRECT_URI', 'https://api.test/auth/oauth/google/callback');
    const start = await request(app.getHttpServer()).get('/auth/oauth/google').expect(200);
    const authorizationUrl = new URL(start.body.authorizationUrl);
    const state = authorizationUrl.searchParams.get('state');
    const challenge = authorizationUrl.searchParams.get('code_challenge');
    expect(authorizationUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(state).toEqual(expect.any(String));
    expect(challenge).toEqual(expect.any(String));

    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async (url, options) => {
      if (String(url) === 'https://oauth.test/token') {
        expect(String(options?.body)).toContain('code_verifier=');
        return new Response(JSON.stringify({ access_token: 'provider-access-token' }), { status: 200 });
      }
      if (String(url) === 'https://oauth.test/userinfo') {
        return new Response(JSON.stringify({ sub: 'google-subject-1', email: 'oauth@example.com', email_verified: true, name: 'OAuth User' }), { status: 200 });
      }
      throw new Error(`Unexpected OAuth request: ${String(url)}`);
    });

    try {
      const callbacks = await Promise.all([
        request(app.getHttpServer()).get(`/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(state ?? '')}`),
        request(app.getHttpServer()).get(`/auth/oauth/google/callback?code=code-1&state=${encodeURIComponent(state ?? '')}`),
      ]);
      expect(callbacks.map((callback) => callback.status).sort()).toEqual([303, 400]);
      expect(callbacks.find((callback) => callback.status === 400)?.body).toEqual({
        error: { code: 'OAUTH_STATE_INVALID', message: expect.any(String) },
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const stored = await app.get(DataSource).getRepository(OAuthState).findOneByOrFail({
        stateHash: createHash('sha256').update(state ?? '').digest('hex'),
      });
      expect(stored.usedAt).toBeInstanceOf(Date);
      expect(createHash('sha256').update(stored.codeVerifier).digest('base64url')).toBe(challenge);
      expect(authorizationUrl.toString()).not.toContain(stored.codeVerifier);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('rejects expired GitHub state before contacting GitHub and converges concurrent first links', async () => {
    const config = app.get(ConfigService);
    const auth = app.get(AuthService);
    const database = app.get(DataSource);
    const users = app.get(UsersService);
    config.set('OAUTH_ENABLED', true);
    config.set('OAUTH_GITHUB_CLIENT_ID', 'github-client');
    config.set('OAUTH_GITHUB_CLIENT_SECRET', 'github-secret');
    config.set('OAUTH_GITHUB_AUTHORIZATION_URL', 'https://github.test/authorize');
    config.set('OAUTH_GITHUB_TOKEN_URL', 'https://github.test/token');
    config.set('OAUTH_GITHUB_USERINFO_URL', 'https://github.test/user');
    config.set('OAUTH_GITHUB_REDIRECT_URI', 'https://api.test/auth/oauth/github/callback');

    const expiredState = 'expired-github-state';
    await database.getRepository(OAuthState).save({
      id: randomUUID(), provider: 'github', stateHash: createHash('sha256').update(expiredState).digest('hex'),
      codeVerifier: 'v'.repeat(86), expiresAt: new Date(Date.now() - 1_000), usedAt: null,
    });
    const fetchMock = jest.spyOn(global, 'fetch').mockImplementation(async () => {
      throw new Error('An expired OAuth state must not contact GitHub.');
    });
    await expect(auth.oauthCallback('github', expiredState, 'expired-code')).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();

    const [first, second] = await Promise.all([auth.oauthStart('github'), auth.oauthStart('github')]);
    const states = [first, second].map(({ authorizationUrl }) => new URL(authorizationUrl).searchParams.get('state')!);
    const originalFindByEmail = users.findByEmail.bind(users);
    let pendingReads = 0;
    let releaseReads!: () => void;
    const bothReads = new Promise<void>((resolve) => { releaseReads = resolve; });
    const findByEmail = jest.spyOn(users, 'findByEmail').mockImplementation(async (...args) => {
      if (args[0] === 'first-link@example.com' && ++pendingReads <= 2) {
        if (pendingReads === 2) releaseReads();
        await bothReads;
      }
      return originalFindByEmail(...args);
    });
    fetchMock.mockImplementation(async (url, options) => {
      if (String(url) === 'https://github.test/token') {
        expect(options?.method).toBe('POST');
        return new Response(JSON.stringify({ access_token: 'github-access' }), { status: 200 });
      }
      if (String(url) === 'https://github.test/user') {
        return new Response(JSON.stringify({ id: 100, login: 'first-link' }), { status: 200 });
      }
      if (String(url) === 'https://api.github.com/user/emails') {
        return new Response(JSON.stringify([{ email: 'first-link@example.com', primary: true, verified: true }]), { status: 200 });
      }
      throw new Error(`Unexpected OAuth request: ${String(url)}`);
    });
    try {
      const results = await Promise.all(states.map((state) => auth.oauthCallback('github', state, 'code')));
      expect(results).toHaveLength(2);
      expect(await database.getRepository(User).countBy({ email: 'first-link@example.com' })).toBe(1);
      expect(await database.getRepository(OAuthAccount).countBy({ provider: 'github', providerAccountId: '100' })).toBe(1);
    } finally {
      findByEmail.mockRestore();
      fetchMock.mockRestore();
    }
  });

  it('verifies raw Stripe signatures and persists each webhook delivery exactly once', async () => {
    const config = app.get(ConfigService);
    const owner = await registerAndLogin(app, { email: 'billing-owner@example.com', password: 'password123', name: 'Billing owner' });
    const organization = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Webhook persistence' })
      .expect(201);
    const stripeKey = 'sk_test_123456789012345678901234';
    const webhookSecret = 'whsec_webhook_persistence';
    config.set('STRIPE_SECRET_KEY', stripeKey);
    config.set('STRIPE_WEBHOOK_SECRET', webhookSecret);
    config.set('STRIPE_PRICE_PLANS', '{"price_pro":{"name":"pro","entitlements":{}}}');
    const payload = JSON.stringify({
      id: 'evt_webhook_persistence', object: 'event', type: 'checkout.session.completed',
      data: { object: { object: 'checkout.session', metadata: { organization_id: organization.body.id }, client_reference_id: organization.body.id, customer: 'cus_webhook_persistence' } },
    });
    const signature = new Stripe(stripeKey).webhooks.generateTestHeaderString({ payload, secret: webhookSecret });

    await request(app.getHttpServer()).post('/billing/webhooks/stripe').set('stripe-signature', signature).set('content-type', 'application/json').send(payload).expect(200, { accepted: true, duplicate: false });
    await request(app.getHttpServer()).post('/billing/webhooks/stripe').set('stripe-signature', signature).set('content-type', 'application/json').send(payload).expect(200, { accepted: true, duplicate: true });

    expect(await app.get(DataSource).getRepository(BillingWebhookEvent).countBy({ provider: 'stripe', providerEventId: 'evt_webhook_persistence' })).toBe(1);
    await expect(app.get(DataSource).getRepository(BillingCustomer).findOneByOrFail({ provider: 'stripe', providerCustomerId: 'cus_webhook_persistence' }))
      .resolves.toMatchObject({ organizationId: organization.body.id });
  });

  it('transfers organization ownership only to an active member and lets the previous owner leave', async () => {
    const owner = await registerAndLogin(app, { email: 'org-owner@example.com', password: 'password123', name: 'Owner' });
    const admin = await registerAndLogin(app, { email: 'org-admin@example.com', password: 'password123', name: 'Admin' });
    const member = await registerAndLogin(app, { email: 'org-member@example.com', password: 'password123', name: 'Member' });
    const organization = await request(app.getHttpServer())
      .post('/organizations')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Ownership E2E' })
      .expect(201);

    for (const invited of [
      { account: admin, email: 'org-admin@example.com', role: 'admin' },
      { account: member, email: 'org-member@example.com', role: 'member' },
    ] as const) {
      await request(app.getHttpServer())
        .post(`/organizations/${organization.body.id}/invitations`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: invited.email, role: invited.role })
        .expect(204);
      const invitation = deliveries.findLast((delivery) =>
        delivery.recipient === invited.email && delivery.subject === 'Organization invitation');
      const token = invitation?.text.match(/token: (\S+)/)?.[1];
      if (!token) throw new Error('Organization invitation token was not delivered');
      await request(app.getHttpServer())
        .post('/organizations/invitations/accept')
        .set('Authorization', `Bearer ${invited.account.accessToken}`)
        .send({ token })
        .expect(201);
    }

    await request(app.getHttpServer())
      .get(`/organizations/${organization.body.id}/audit-logs`)
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/organizations/${organization.body.id}/members/${admin.userId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ role: 'member' })
      .expect(204);

    for (const account of [admin, member]) {
      await request(app.getHttpServer())
        .post(`/organizations/${organization.body.id}/ownership/transfer`)
        .set('Authorization', `Bearer ${account.accessToken}`)
        .send({ userId: member.userId })
        .expect(403)
        .expect({ error: { code: 'ORGANIZATION_ACCESS_DENIED', message: 'You do not have permission for this organization.' } });
    }

    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .expect(200);
    for (const userId of [member.userId, randomUUID()]) {
      await request(app.getHttpServer())
        .post(`/organizations/${organization.body.id}/ownership/transfer`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ userId })
        .expect(409)
        .expect({ error: { code: 'OWNERSHIP_TARGET_NOT_ELIGIBLE', message: 'Ownership can only be transferred to an active organization member.' } });
    }

    await request(app.getHttpServer())
      .post(`/organizations/${organization.body.id}/ownership/transfer`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ userId: admin.userId })
      .expect(204);
    const transferredMembers = await request(app.getHttpServer())
      .get(`/organizations/${organization.body.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(transferredMembers.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ userId: owner.userId, role: 'admin' }),
      expect.objectContaining({ userId: admin.userId, role: 'owner' }),
    ]));

    await request(app.getHttpServer())
      .delete(`/organizations/${organization.body.id}/members/${owner.userId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete('/users/me')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);
    const remainingMembers = await request(app.getHttpServer())
      .get(`/organizations/${organization.body.id}/members`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(remainingMembers.body.some((membership: { userId: string }) => membership.userId === owner.userId)).toBe(false);
    expect(remainingMembers.body.filter((membership: { role: string }) => membership.role === 'owner')).toHaveLength(1);

    const firstAuditPage = await request(app.getHttpServer())
      .get(`/organizations/${organization.body.id}/audit-logs?limit=2`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(firstAuditPage.body.items).toHaveLength(2);
    expect(firstAuditPage.body.nextCursor).toEqual(expect.any(String));
    const secondAuditPage = await request(app.getHttpServer())
      .get(`/organizations/${organization.body.id}/audit-logs?limit=100&cursor=${firstAuditPage.body.nextCursor}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const auditItems = [...firstAuditPage.body.items, ...secondAuditPage.body.items];
    expect(new Set(auditItems.map((item: { id: string }) => item.id)).size).toBe(auditItems.length);
    expect(auditItems.map((item: { action: string }) => item.action)).toEqual(expect.arrayContaining([
      'organization.invitation.created',
      'organization.invitation.accepted',
      'organization.member.role_changed',
      'organization.ownership.transferred',
      'organization.member.removed',
    ]));
    const serializedAudit = JSON.stringify(auditItems);
    for (const delivery of deliveries) {
      const deliveredToken = delivery.text.match(/[?&]token=([^\s]+)/)?.[1] ?? delivery.text.match(/token: (\S+)/)?.[1];
      if (deliveredToken) expect(serializedAudit).not.toContain(decodeURIComponent(deliveredToken));
    }
    expect(serializedAudit).not.toMatch(/tokenHash|sessionId|providerCustomerId|paymentMethod|card/i);
  });

  afterEach(async () => {
    await app?.close();
  });
});

function cookieValues(response: request.Response): { refresh: string; csrf: string; header: string } {
  const cookies = response.headers['set-cookie'];
  const values = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
  const refresh = cookieValue(values, 'refresh_token');
  const csrf = cookieValue(values, 'csrf_token');
  return { refresh, csrf, header: `refresh_token=${refresh}; csrf_token=${csrf}` };
}

function cookieValue(cookies: string[], name: string): string {
  const value = cookies.find((cookie) => cookie.startsWith(`${name}=`))?.split(';', 1)[0].slice(name.length + 1);
  if (!value) throw new Error(`${name} cookie was not set`);
  return value;
}

function tokenFrom(text: string | undefined): string {
  const value = text?.match(/[?&]token=([^\s]+)/)?.[1];
  if (!value) throw new Error('A one-time token was not delivered');
  return decodeURIComponent(value);
}

function loginPayload(credentials: { email: string; password: string }): { email: string; password: string } {
  return { email: credentials.email, password: credentials.password };
}

async function registerAndLogin(
  app: INestApplication<App>,
  credentials: { email: string; password: string; name: string },
): Promise<{ userId: string; accessToken: string }> {
  const registration = await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
  const login = await request(app.getHttpServer()).post('/auth/login').send(loginPayload(credentials)).expect(200);
  return { userId: registration.body.id, accessToken: login.body.accessToken };
}

async function resetDatabase(dataSource: DataSource): Promise<void> {
  if (dataSource.options.type === 'postgres') {
    await dataSource.query('TRUNCATE TABLE "billing_webhook_events", "users" RESTART IDENTITY CASCADE');
    return;
  }
  await dataSource.synchronize(true);
}
