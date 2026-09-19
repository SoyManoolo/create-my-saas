import { z } from 'zod';

export const registerBody = z.object({
  email: z.string().email().max(320),
  name: z.string().trim().min(1).max(255),
  password: z.string().min(8).max(256).refine((password) => /[a-zA-Z]/.test(password) && /\d/.test(password), {
    message: 'Password must contain at least one letter and one number.',
  }),
});

// Password-complexity rules apply when a password is created or changed, not
// when checking existing credentials. Otherwise an incorrect password can
// reveal validation details and return 400 instead of the uniform 401.
export const loginBody = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(256),
});
export const resetRequestBody = z.object({ email: z.string().email().max(320) });
export const resetConfirmBody = z.object({
  token: z.string().min(20).max(512),
  newPassword: registerBody.shape.password,
});
export const tokenBody = z.object({ token: z.string().min(20).max(512) });
export const oauthCallbackQuery = z.object({ code: z.string().min(1), state: z.string().min(1) });
