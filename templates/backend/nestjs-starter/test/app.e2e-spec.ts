import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApplication } from './../src/app.setup';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  it('only advertises Google and GitHub OAuth when fully configured', async () => {
    await request(app.getHttpServer()).get('/auth/oauth/providers').expect(200).expect([
      { provider: 'google', configured: false },
      { provider: 'github', configured: false },
    ]);
  });

  afterEach(async () => {
    await app?.close();
  });
});
