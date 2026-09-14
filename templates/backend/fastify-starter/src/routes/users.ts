import type { FastifyInstance } from 'fastify';
import type { AuthService } from '../auth/service.js';
import { toPublicUser } from '../auth/tokens.js';

export function registerUserRoutes(app: FastifyInstance, auth: AuthService): void {
  app.get('/users/me', async (request, reply) => {
    const user = await auth.currentUser(request.headers.authorization);
    return reply.send({ user: toPublicUser(user) });
  });
}
