import { z } from 'zod';

export const registerBody = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(256).refine((password) => /[a-zA-Z]/.test(password) && /\d/.test(password), {
    message: 'Password must contain at least one letter and one number.',
  }),
});

export const loginBody = registerBody.pick({ email: true, password: true });
export const resetRequestBody = z.object({ email: z.string().email().max(320) });
export const resetConfirmBody = z.object({
  token: z.string().min(20).max(512),
  newPassword: registerBody.shape.password,
});
export const tokenBody = z.object({ token: z.string().min(20).max(512) });
export const oauthCallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });
