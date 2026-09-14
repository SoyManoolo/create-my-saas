import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApplication } from './../src/app.setup';
import { SecureEmailService } from './../src/auth/secure-email.service';
import { randomUUID } from 'node:crypto';

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

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
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
