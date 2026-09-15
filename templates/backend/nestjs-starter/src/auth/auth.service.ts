import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, MoreThan, Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { UserPublicDto } from '../users/dto/user-public.dto';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthToken } from './auth-token.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshSession } from './refresh-session.entity';
import { OAuthState } from './oauth-state.entity';
import { OAuthAccount } from './oauth-account.entity';
import { SecureEmailService } from './secure-email.service';

export type AuthenticationResult = { accessToken: string; user: UserPublicDto };
export type BrowserAuthenticationResult = { authentication: AuthenticationResult; refreshToken: string };
type RequestMetadata = { ip?: string; userAgent?: string };
type TokenKind = 'password_reset' | 'email_verification';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    @InjectRepository(RefreshSession) private readonly sessions: Repository<RefreshSession>,
    @InjectRepository(AuthToken) private readonly tokens: Repository<AuthToken>,
    @InjectRepository(OAuthState) private readonly oauthStates: Repository<OAuthState>,
    @InjectRepository(OAuthAccount) private readonly oauthAccounts: Repository<OAuthAccount>,
    private readonly dataSource: DataSource,
    private readonly secureEmail: SecureEmailService,
  ) {}

  async register(dto: RegisterDto): Promise<UserPublicDto> {
    const email = dto.email.toLowerCase();
    if (await this.usersService.findByEmail(email)) throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.', 409);
    try {
      const user = await this.usersService.create({ email, name: dto.name, passwordHash: await this.hashPassword(dto.password) });
      await this.sendOneTimeToken(user, 'email_verification');
      return UserPublicDto.fromEntity(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.', 409);
      throw error;
    }
  }

  async login(dto: LoginDto, metadata: RequestMetadata = {}): Promise<BrowserAuthenticationResult> {
    const user = await this.usersService.findByEmail(dto.email, true);
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, dto.password))) throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect.', 401);
    if (!user.isActive) throw new AppError('USER_INACTIVE', 'The user account is inactive.', 403);
    return this.createAuthentication(user, metadata);
  }

  async refresh(refreshToken: string, metadata: RequestMetadata = {}): Promise<BrowserAuthenticationResult> {
    const outcome = await this.dataSource.transaction(async (manager) => {
      const sessions = manager.getRepository(RefreshSession);
      const now = new Date();
      const session = await sessions.findOneBy({ tokenHash: this.hashToken(refreshToken) });
      if (!session || session.expiresAt <= now) return { kind: 'invalid' as const };
      if (session.revokedAt) {
        if (session.replacedById) await sessions.update({ userId: session.userId, revokedAt: IsNull() }, { revokedAt: now });
        return { kind: session.replacedById ? 'reused' as const : 'invalid' as const };
      }

      const nextRaw = this.newOpaqueToken();
      const changed = await sessions.update(
        { id: session.id, revokedAt: IsNull(), expiresAt: MoreThan(now) },
        { revokedAt: now, replacedById: this.sessionIdFromToken(nextRaw) },
      );
      if (!changed.affected) {
        await sessions.update({ userId: session.userId, revokedAt: IsNull() }, { revokedAt: now });
        return { kind: 'reused' as const };
      }

      const user = await manager.getRepository(User).findOneBy({ id: session.userId, isActive: true });
      if (!user) return { kind: 'invalid' as const };
      await sessions.save(sessions.create({
        id: this.sessionIdFromToken(nextRaw), userId: user.id, tokenHash: this.hashToken(nextRaw),
        expiresAt: new Date(Date.now() + this.config.get<number>('REFRESH_TOKEN_EXPIRE_DAYS', 30) * 86_400_000),
        revokedAt: null, replacedById: null, ipAddress: metadata.ip ?? null, userAgent: metadata.userAgent ?? null,
      }));
      return { kind: 'rotated' as const, user, nextRaw };
    });
    if (outcome.kind === 'rotated') {
      return { authentication: { accessToken: await this.jwtService.signAsync({ sub: outcome.user.id, type: 'access', jti: randomBytes(16).toString('hex') }), user: UserPublicDto.fromEntity(outcome.user) }, refreshToken: outcome.nextRaw };
    }
    throw new AppError(outcome.kind === 'reused' ? 'REFRESH_TOKEN_REUSED' : 'INVALID_REFRESH_TOKEN', outcome.kind === 'reused' ? 'The refresh token was already used; all sessions were revoked.' : 'The refresh token is invalid or expired.', 401);
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) await this.sessions.update({ tokenHash: this.hashToken(refreshToken), revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async changePassword(user: User, currentPassword: string, newPassword: string): Promise<void> {
    const secured = await this.usersService.findByEmail(user.email, true);
    if (!secured?.passwordHash || !(await argon2.verify(secured.passwordHash, currentPassword))) throw new AppError('INVALID_CREDENTIALS', 'The current password is incorrect.', 401);
    await this.usersService.updatePassword(user, await this.hashPassword(newPassword));
    await this.revokeUserSessions(user.id);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user?.isActive) return;
    try {
      await this.sendOneTimeToken(user, 'password_reset');
    } catch (error) {
      // The response must remain the same for existing and non-existing addresses.
      // A delivery outage is an operational concern, never an account-enumeration oracle.
      if (error instanceof AppError && error.code === 'EMAIL_DELIVERY_UNAVAILABLE') return;
      throw error;
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.consumeToken(token, 'password_reset');
    const user = await this.usersService.findById(record.userId);
    if (!user?.isActive) throw new AppError('INVALID_RESET_TOKEN', 'The reset token is invalid or expired.', 400);
    await this.usersService.updatePassword(user, await this.hashPassword(newPassword));
    await this.revokeUserSessions(user.id);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.consumeToken(token, 'email_verification');
    const user = await this.usersService.findById(record.userId);
    if (user) { user.emailVerified = true; await this.usersService.save(user); }
  }
  async resendEmailVerification(user: User): Promise<void> { if (!user.emailVerified) await this.sendOneTimeToken(user, 'email_verification'); }
  oauthProviders(): Array<{ provider: string; configured: boolean }> { return ['google', 'github'].map((provider) => ({ provider, configured: Boolean(this.oauthConfig(provider)) })); }
  async oauthStart(provider: string): Promise<{ authorizationUrl: string }> {
    const config = this.oauthConfig(provider);
    if (!config) throw new AppError('OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.', 404);
    const state = this.newOpaqueToken(); const verifier = this.newOpaqueToken();
    await this.oauthStates.save(this.oauthStates.create({ provider, stateHash: this.hashToken(state), codeVerifier: verifier, usedAt: null, expiresAt: new Date(Date.now() + 10 * 60_000) }));
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(config.authorizationUrl); url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', config.clientId); url.searchParams.set('redirect_uri', config.redirectUri); url.searchParams.set('scope', config.scopes); url.searchParams.set('state', state); url.searchParams.set('code_challenge', challenge); url.searchParams.set('code_challenge_method', 'S256');
    return { authorizationUrl: url.toString() };
  }
  async oauthCallback(provider: string, state: string, code: string): Promise<BrowserAuthenticationResult> {
    const config = this.oauthConfig(provider);
    if (!config) throw new AppError('OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.', 404);
    if (!code) throw new AppError('OAUTH_CALLBACK_INVALID', 'OAuth authorization code is required.', 400);
    const record = await this.oauthStates.findOneBy({ provider, stateHash: this.hashToken(state), usedAt: IsNull() });
    if (!record || record.expiresAt <= new Date()) throw new AppError('OAUTH_STATE_INVALID', 'OAuth state is invalid or expired.', 400);
    const used = await this.oauthStates.update({ id: record.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!used.affected) throw new AppError('OAUTH_STATE_INVALID', 'OAuth state was already used.', 400);
    const profile = await this.exchangeOAuthProfile(provider, code, record.codeVerifier, config);
    const account = await this.oauthAccounts.findOneBy({ provider, providerAccountId: profile.providerAccountId });
    const emailUser = await this.usersService.findByEmail(profile.email);
    if (account) {
      if (emailUser && emailUser.id !== account.userId) throw new AppError('OAUTH_ACCOUNT_CONFLICT', 'This OAuth account is linked to a different user.', 409);
      const user = await this.usersService.findById(account.userId);
      if (!user) throw new AppError('OAUTH_ACCOUNT_CONFLICT', 'This OAuth account is linked to a different user.', 409);
      return this.completeOAuthAuthentication(user);
    }
    const user = emailUser ?? await this.usersService.create({ email: profile.email, name: profile.name, passwordHash: null });
    try {
      const linked = await this.oauthAccounts.save(this.oauthAccounts.create({ provider, providerAccountId: profile.providerAccountId, userId: user.id }));
      if (linked.userId !== user.id) throw new AppError('OAUTH_ACCOUNT_CONFLICT', 'This OAuth account is linked to a different user.', 409);
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      const linked = await this.oauthAccounts.findOneBy({ provider, providerAccountId: profile.providerAccountId });
      if (!linked || linked.userId !== user.id) throw new AppError('OAUTH_ACCOUNT_CONFLICT', 'This OAuth account is linked to a different user.', 409);
    }
    return this.completeOAuthAuthentication(user);
  }

  private async completeOAuthAuthentication(user: User): Promise<BrowserAuthenticationResult> {
    if (!user.isActive) throw new AppError('USER_INACTIVE', 'The user account is inactive.', 403);
    if (!user.emailVerified) { user.emailVerified = true; await this.usersService.save(user); }
    return this.createAuthentication(user, {});
  }

  private async createAuthentication(user: User, metadata: RequestMetadata): Promise<BrowserAuthenticationResult> {
    const refreshToken = this.newOpaqueToken();
    await this.sessions.save(this.sessions.create({ id: this.sessionIdFromToken(refreshToken), userId: user.id, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + this.config.get<number>('REFRESH_TOKEN_EXPIRE_DAYS', 30) * 86_400_000), revokedAt: null, replacedById: null, ipAddress: metadata.ip ?? null, userAgent: metadata.userAgent ?? null }));
    return { authentication: { accessToken: await this.jwtService.signAsync({ sub: user.id, type: 'access', jti: randomBytes(16).toString('hex') }), user: UserPublicDto.fromEntity(user) }, refreshToken };
  }
  private oauthConfig(provider: string): { clientId: string; clientSecret: string; authorizationUrl: string; tokenUrl: string; userInfoUrl: string; redirectUri: string; scopes: string } | null {
    if (!this.config.get<boolean>('OAUTH_ENABLED', false) || !['google', 'github'].includes(provider)) return null;
    const key = provider.toUpperCase();
    const clientId = this.config.get<string>(`OAUTH_${key}_CLIENT_ID`);
    const clientSecret = this.config.get<string>(`OAUTH_${key}_CLIENT_SECRET`);
    const redirectUri = this.config.get<string>(`OAUTH_${key}_REDIRECT_URI`);
    if (!clientId || !clientSecret || !redirectUri) return null;
    const google = provider === 'google';
    return {
      clientId, clientSecret, redirectUri,
      authorizationUrl: this.config.get<string>(`OAUTH_${key}_AUTHORIZATION_URL`, google ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://github.com/login/oauth/authorize'),
      tokenUrl: this.config.get<string>(`OAUTH_${key}_TOKEN_URL`, google ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token'),
      userInfoUrl: this.config.get<string>(`OAUTH_${key}_USERINFO_URL`, google ? 'https://openidconnect.googleapis.com/v1/userinfo' : 'https://api.github.com/user'),
      scopes: this.config.get<string>(`OAUTH_${key}_SCOPES`, google ? 'openid email profile' : 'read:user user:email'),
    };
  }
  private async exchangeOAuthProfile(provider: string, code: string, verifier: string, config: { clientId: string; clientSecret: string; tokenUrl: string; userInfoUrl: string; redirectUri: string }): Promise<{ email: string; name: string; providerAccountId: string }> {
    const token = await this.oauthJson(config.tokenUrl, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code_verifier: verifier }) });
    if (typeof token.access_token !== 'string' || !token.access_token) throw new AppError('OAUTH_PROVIDER_ERROR', 'The OAuth provider did not return an access token.', 502);
    const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'User-Agent': 'create-my-saas' };
    const profile = await this.oauthJson(config.userInfoUrl, { headers });
    if (provider === 'github' && !profile.email) {
      const emails = await this.oauthJson('https://api.github.com/user/emails', { headers }) as Array<Record<string, unknown>>;
      profile.email = emails.find((item) => item.primary === true && item.verified === true)?.email;
    }
    const verified = provider === 'google' ? profile.email_verified === true : Boolean(profile.email);
    if (typeof profile.email !== 'string' || !profile.email || !verified) throw new AppError('OAUTH_EMAIL_UNVERIFIED', 'The OAuth provider did not provide a verified email address.', 400);
    const providerAccountId = provider === 'google' ? profile.sub : profile.id;
    if ((typeof providerAccountId !== 'string' && typeof providerAccountId !== 'number') || !String(providerAccountId)) throw new AppError('OAUTH_PROVIDER_ERROR', 'The OAuth provider did not return a stable account identifier.', 502);
    return { email: profile.email.toLowerCase(), name: String(profile.name ?? profile.login ?? profile.email.split('@')[0]).slice(0, 120), providerAccountId: String(providerAccountId) };
  }
  private async oauthJson(url: string, options: RequestInit): Promise<any> {
    let response: Response;
    try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new AppError('OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.', 502); }
    if (!response.ok) throw new AppError('OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.', 502);
    try { return await response.json(); }
    catch { throw new AppError('OAUTH_PROVIDER_ERROR', 'The OAuth provider returned an invalid response.', 502); }
  }
  private async createOneTimeToken(userId: string, kind: TokenKind): Promise<string> {
    await this.tokens.update({ userId, kind, usedAt: IsNull() }, { usedAt: new Date() });
    const raw = this.newOpaqueToken();
    await this.tokens.save(this.tokens.create({ userId, kind, tokenHash: this.hashToken(raw), usedAt: null, expiresAt: new Date(Date.now() + this.config.get<number>(kind === 'password_reset' ? 'PASSWORD_RESET_EXPIRE_MINUTES' : 'EMAIL_VERIFICATION_EXPIRE_MINUTES', 60) * 60_000) }));
    return raw;
  }
  private async sendOneTimeToken(user: User, kind: TokenKind): Promise<void> {
    const raw = await this.createOneTimeToken(user.id, kind);
    const isReset = kind === 'password_reset';
    const path = isReset ? '/reset-password' : '/verify-email';
    const url = `${this.config.get<string>('FRONTEND_URL', 'http://localhost:3000').replace(/\/$/, '')}${path}?token=${raw}`;
    await this.secureEmail.send(user.email, isReset ? 'Reset your password' : 'Verify your email', `Use this one-time link: ${url}`);
  }
  private async consumeToken(raw: string, kind: TokenKind): Promise<AuthToken> {
    const record = await this.tokens.findOneBy({ tokenHash: this.hashToken(raw), kind, usedAt: IsNull() });
    if (!record || record.expiresAt <= new Date()) throw new AppError('INVALID_TOKEN', 'The token is invalid or expired.', 400);
    const result = await this.tokens.update({ id: record.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!result.affected) throw new AppError('INVALID_TOKEN', 'The token has already been used.', 400);
    return record;
  }
  private revokeUserSessions(userId: string): Promise<unknown> { return this.sessions.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() }); }
  private hashPassword(value: string): Promise<string> { return argon2.hash(value, { type: argon2.argon2id }); }
  private newOpaqueToken(): string { return randomBytes(48).toString('base64url'); }
  private hashToken(value: string): string { return createHash('sha256').update(value).digest('hex'); }
  private sessionIdFromToken(token: string): string { const b = createHash('sha256').update(token).digest(); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const h = b.toString('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`; }
  private isUniqueViolation(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'; }
}
