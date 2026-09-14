import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import type { Config } from '../config.js';
import { EmailDeliveryError, type EmailSender } from '../email.js';
import { AppError } from '../http/errors.js';
import type { OneTimeTokenKind, SessionRepository, StoredSession, StoredUser } from '../types.js';
import { buildAuthorizationUrl, exchangeOAuthProfile, getOAuthConfig } from './oauth.js';
import { opaqueToken, tokenHash } from './tokens.js';

type SessionTokens = { accessToken: string; refreshToken: string };

export class AuthService {
  private readonly accessMaxAge: number;
  private readonly refreshMaxAge: number;

  constructor(
    private readonly config: Config,
    private readonly repository: SessionRepository,
    private readonly emailSender: EmailSender,
  ) {
    this.accessMaxAge = config.ACCESS_TOKEN_EXPIRE_MINUTES * 60;
    this.refreshMaxAge = config.REFRESH_TOKEN_EXPIRE_DAYS * 86_400;
  }

  async register(input: { email: string; name: string; password: string }): Promise<StoredUser> {
    const email = input.email.toLowerCase();
    if (await this.repository.findUserByEmail(email)) {
      throw new AppError(409, 'EMAIL_ALREADY_EXISTS', 'An account with this email already exists.');
    }
    const user = await this.repository.createUser({
      email,
      name: input.name,
      passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
    });
    await this.sendOneTimeToken(user, 'email_verification');
    return user;
  }

  async login(email: string, password: string): Promise<{ user: StoredUser } & SessionTokens> {
    const user = await this.repository.findUserByEmail(email.toLowerCase());
    if (!user || !user.isActive || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'The email or password is incorrect.');
    }
    return { user, ...await this.issueSession(user) };
  }

  async refresh(previousToken: string | undefined): Promise<{ user: StoredUser } & SessionTokens> {
    if (!previousToken) throw this.invalidRefreshToken();
    const previous = await this.repository.findActiveSessionByRefreshHash(tokenHash(previousToken));
    if (!previous) throw this.invalidRefreshToken();
    const user = await this.repository.findUserById(previous.userId);
    if (!user || !user.isActive) throw this.invalidRefreshToken();
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const rotated = await this.repository.rotateSession({
      previousSessionId: previous.id,
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(refreshToken),
      accessExpiresAt: new Date(Date.now() + this.accessMaxAge * 1_000),
      refreshExpiresAt: new Date(Date.now() + this.refreshMaxAge * 1_000),
    });
    if (!rotated) throw new AppError(401, 'REFRESH_TOKEN_REUSED', 'Authentication is required.');
    return { user, accessToken, refreshToken };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const session = await this.repository.findActiveSessionByRefreshHash(tokenHash(refreshToken));
    if (session) await this.repository.revokeSession(session.id);
  }

  async currentUser(authorization: string | undefined): Promise<StoredUser> {
    const accessToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : '';
    if (!accessToken) throw this.unauthorized();
    const session = await this.repository.findActiveSessionByAccessHash(tokenHash(accessToken));
    if (!session) throw this.unauthorized();
    const user = await this.repository.findUserById(session.userId);
    if (!user || !user.isActive) throw this.unauthorized();
    return user;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email.toLowerCase());
    if (!user?.isActive) return;
    try {
      await this.sendOneTimeToken(user, 'password_reset');
    } catch (error) {
      if (!(error instanceof EmailDeliveryError)) throw error;
    }
  }

  async confirmPasswordReset(rawToken: string, newPassword: string): Promise<void> {
    const record = await this.repository.consumeOneTimeToken(tokenHash(rawToken), 'password_reset');
    const user = record && await this.repository.findUserById(record.userId);
    if (!user?.isActive) throw new AppError(400, 'INVALID_RESET_TOKEN', 'Reset token is invalid or expired.');
    await this.repository.updateUserPassword(user.id, await argon2.hash(newPassword, { type: argon2.argon2id }));
    await this.repository.revokeSessionsForUser(user.id);
  }

  async verifyEmail(rawToken: string): Promise<void> {
    const record = await this.repository.consumeOneTimeToken(tokenHash(rawToken), 'email_verification');
    if (!record) throw new AppError(400, 'INVALID_VERIFICATION_TOKEN', 'Verification token is invalid or expired.');
    await this.repository.setEmailVerified(record.userId);
  }

  async resendVerification(user: StoredUser): Promise<void> {
    if (!user.emailVerified) await this.sendOneTimeToken(user, 'email_verification');
  }

  oauthProviders() {
    return ['google', 'github'].map((provider) => ({ provider, configured: Boolean(getOAuthConfig(this.config, provider)) }));
  }

  async createOAuthStart(provider: string): Promise<{ authorizationUrl: string }> {
    const providerConfig = getOAuthConfig(this.config, provider);
    if (!providerConfig) throw new AppError(404, 'OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.');
    const state = opaqueToken();
    const verifier = opaqueToken();
    await this.repository.createOAuthState({
      id: randomUUID(),
      provider,
      stateHash: tokenHash(state),
      codeVerifier: verifier,
      expiresAt: new Date(Date.now() + 10 * 60_000),
      usedAt: null,
    });
    return { authorizationUrl: buildAuthorizationUrl(providerConfig, state, verifier) };
  }

  async completeOAuth(provider: string, code: string, stateToken: string): Promise<SessionTokens> {
    const providerConfig = getOAuthConfig(this.config, provider);
    if (!providerConfig) throw new AppError(404, 'OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.');
    const state = await this.repository.consumeOAuthState(provider, tokenHash(stateToken));
    if (!state) throw new AppError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired.');
    const profile = await exchangeOAuthProfile(provider, code, state.codeVerifier, providerConfig);
    let user = await this.repository.findUserByEmail(profile.email);
    if (!user) {
      user = await this.repository.createUser({ email: profile.email, name: profile.name, passwordHash: null, emailVerified: true });
    }
    if (!user.isActive) throw new AppError(403, 'USER_INACTIVE', 'The user account is inactive.');
    if (!user.emailVerified) await this.repository.setEmailVerified(user.id);
    return this.issueSession(user);
  }

  private async issueSession(user: StoredUser): Promise<SessionTokens> {
    const accessToken = opaqueToken();
    const refreshToken = opaqueToken();
    const session: StoredSession = {
      id: randomUUID(),
      userId: user.id,
      accessTokenHash: tokenHash(accessToken),
      refreshTokenHash: tokenHash(refreshToken),
      accessExpiresAt: new Date(Date.now() + this.accessMaxAge * 1_000),
      refreshExpiresAt: new Date(Date.now() + this.refreshMaxAge * 1_000),
      revokedAt: null,
    };
    await this.repository.createSession(session);
    return { accessToken, refreshToken };
  }

  private async sendOneTimeToken(user: StoredUser, kind: OneTimeTokenKind): Promise<void> {
    const rawToken = opaqueToken();
    await this.repository.createOneTimeToken({
      id: randomUUID(),
      userId: user.id,
      kind,
      tokenHash: tokenHash(rawToken),
      expiresAt: new Date(Date.now() + (
        kind === 'password_reset' ? this.config.PASSWORD_RESET_EXPIRE_MINUTES : this.config.EMAIL_VERIFICATION_EXPIRE_MINUTES
      ) * 60_000),
      usedAt: null,
    });
    const reset = kind === 'password_reset';
    const link = `${this.config.FRONTEND_URL.replace(/\/$/, '')}${reset ? '/reset-password' : '/verify-email'}?token=${encodeURIComponent(rawToken)}`;
    await this.emailSender.send(user.email, reset ? 'Reset your password' : 'Verify your email', `Use this one-time link: ${link}`);
  }

  private unauthorized(code = 'UNAUTHORIZED') {
    return new AppError(401, code, 'Authentication is required.');
  }

  private invalidRefreshToken() {
    return this.unauthorized('INVALID_REFRESH_TOKEN');
  }
}
