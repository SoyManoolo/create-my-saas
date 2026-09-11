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
      password: 'password-that-is-long-enough',
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
      password: 'password-that-is-long-enough',
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

  afterEach(async () => {
    await app?.close();
  });
});
