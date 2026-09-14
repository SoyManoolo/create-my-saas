import type { FastifyInstance } from 'fastify';
import { SessionCookies } from '../auth/cookies.js';
import {
  loginBody,
  oauthCallbackQuery,
  registerBody,
  resetConfirmBody,
  resetRequestBody,
  tokenBody,
} from '../auth/schemas.js';
import type { AuthService } from '../auth/service.js';
import { toPublicUser } from '../auth/tokens.js';
import type { Config } from '../config.js';

type AuthRouteDependencies = { auth: AuthService; config: Config };

export function registerAuthRoutes(app: FastifyInstance, { auth, config }: AuthRouteDependencies): void {
  const cookies = new SessionCookies(config);

  app.post('/auth/register', async (request, reply) => {
    const user = await auth.register(registerBody.parse(request.body));
    return reply.code(201).send({ user: toPublicUser(user) });
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginBody.parse(request.body);
    const session = await auth.login(body.email, body.password);
    cookies.set(reply, session.refreshToken);
    return reply.send({ accessToken: session.accessToken, user: toPublicUser(session.user) });
  });

  app.post('/auth/refresh', async (request, reply) => {
    if (!cookies.requireCsrf(request, reply)) return reply;
    const session = await auth.refresh(cookies.refreshToken(request));
    cookies.set(reply, session.refreshToken);
    return reply.send({ accessToken: session.accessToken, user: toPublicUser(session.user) });
  });

  app.post('/auth/logout', async (request, reply) => {
    if (!cookies.requireCsrf(request, reply)) return reply;
    await auth.logout(cookies.refreshToken(request));
    cookies.clear(reply);
    return reply.code(204).send();
  });

  app.post('/auth/password/reset/request', async (request, reply) => {
    const body = resetRequestBody.parse(request.body);
    await auth.requestPasswordReset(body.email);
    return reply.code(204).send();
  });

  app.post('/auth/password/reset/confirm', async (request, reply) => {
    const body = resetConfirmBody.parse(request.body);
    await auth.confirmPasswordReset(body.token, body.newPassword);
    return reply.code(204).send();
  });

  app.post('/auth/email/verify', async (request, reply) => {
    const body = tokenBody.parse(request.body);
    await auth.verifyEmail(body.token);
    return reply.code(204).send();
  });

  app.post('/auth/email/resend', async (request, reply) => {
    const user = await auth.currentUser(request.headers.authorization);
    await auth.resendVerification(user);
    return reply.code(204).send();
  });

  app.get('/auth/oauth/providers', async () => auth.oauthProviders());

  app.get('/auth/oauth/:provider', async (request) => auth.createOAuthStart((request.params as { provider: string }).provider));

  app.get('/auth/oauth/:provider/start', async (request, reply) => {
    const start = await auth.createOAuthStart((request.params as { provider: string }).provider);
    return reply.redirect(start.authorizationUrl);
  });

  app.get('/auth/oauth/:provider/callback', async (request, reply) => {
    const provider = (request.params as { provider: string }).provider;
    const query = oauthCallbackQuery.parse(request.query);
    const session = await auth.completeOAuth(provider, query.code, query.state);
    cookies.set(reply, session.refreshToken);
    return reply.code(303).redirect(`${config.FRONTEND_URL.replace(/\/$/, '')}/auth/oauth/callback`);
  });
}
