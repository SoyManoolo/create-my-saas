import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AppError } from '../common/errors/app.error';
import { UserPublicDto } from '../users/dto/user-public.dto';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthToken } from './auth-token.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshSession } from './refresh-session.entity';
import { OAuthState } from './oauth-state.entity';

export type AuthenticationResult = { accessToken: string; refreshToken: string; user: UserPublicDto };
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
  ) {}

  async register(dto: RegisterDto): Promise<UserPublicDto> {
    const email = dto.email.toLowerCase();
    if (await this.usersService.findByEmail(email)) throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.', 409);
    try {
      const user = await this.usersService.create({ email, name: dto.name, passwordHash: await this.hashPassword(dto.password) });
      await this.createOneTimeToken(user.id, 'email_verification');
      return UserPublicDto.fromEntity(user);
    } catch (error) {
      if (this.isUniqueViolation(error)) throw new AppError('EMAIL_ALREADY_EXISTS', 'An account with this email already exists.', 409);
      throw error;
    }
  }

  async login(dto: LoginDto, metadata: RequestMetadata = {}): Promise<AuthenticationResult> {
    const user = await this.usersService.findByEmail(dto.email, true);
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, dto.password))) throw new AppError('INVALID_CREDENTIALS', 'The email or password is incorrect.', 401);
    if (!user.isActive) throw new AppError('USER_INACTIVE', 'The user account is inactive.', 403);
    return this.createAuthentication(user, metadata);
  }

  async refresh(refreshToken: string, metadata: RequestMetadata = {}): Promise<AuthenticationResult> {
    const session = await this.sessions.findOneBy({ tokenHash: this.hashToken(refreshToken) });
    if (!session || session.expiresAt <= new Date()) throw new AppError('INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.', 401);
    if (session.revokedAt) {
      if (session.replacedById) await this.revokeUserSessions(session.userId);
      throw new AppError(session.replacedById ? 'REFRESH_TOKEN_REUSED' : 'INVALID_REFRESH_TOKEN', 'The refresh token is invalid or expired.', 401);
    }
    const user = await this.usersService.findActiveById(session.userId);
    const next = await this.createAuthentication(user, metadata);
    const changed = await this.sessions.update({ id: session.id, revokedAt: IsNull() }, { revokedAt: new Date(), replacedById: this.sessionIdFromToken(next.refreshToken) });
    if (!changed.affected) {
      await this.revokeUserSessions(user.id);
      throw new AppError('REFRESH_TOKEN_REUSED', 'The refresh token was already used; all sessions were revoked.', 401);
    }
    return next;
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
    if (user?.isActive) await this.createOneTimeToken(user.id, 'password_reset');
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
  async resendEmailVerification(user: User): Promise<void> { if (!user.emailVerified) await this.createOneTimeToken(user.id, 'email_verification'); }
  oauthProviders(): Array<{ provider: string; configured: boolean }> { return ['google', 'github'].map((provider) => ({ provider, configured: Boolean(this.config.get<string>(`OAUTH_${provider.toUpperCase()}_CLIENT_ID`) && this.config.get<string>(`OAUTH_${provider.toUpperCase()}_AUTHORIZATION_URL`)) })); }
  async oauthStart(provider: string): Promise<{ authorizationUrl: string }> {
    const key = provider.toUpperCase();
    const clientId = this.config.get<string>(`OAUTH_${key}_CLIENT_ID`);
    const authorizationUrl = this.config.get<string>(`OAUTH_${key}_AUTHORIZATION_URL`);
    const redirectUri = this.config.get<string>(`OAUTH_${key}_REDIRECT_URI`);
    if (!clientId || !authorizationUrl || !redirectUri || !this.oauthProviders().some((item) => item.provider === provider)) throw new AppError('OAUTH_PROVIDER_UNAVAILABLE', 'This OAuth provider is not configured.', 404);
    const state = this.newOpaqueToken(); const verifier = this.newOpaqueToken();
    await this.oauthStates.save(this.oauthStates.create({ provider, stateHash: this.hashToken(state), codeVerifier: verifier, usedAt: null, expiresAt: new Date(Date.now() + 10 * 60_000) }));
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const url = new URL(authorizationUrl); url.searchParams.set('response_type', 'code'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('scope', this.config.get<string>(`OAUTH_${key}_SCOPES`, 'openid email profile')); url.searchParams.set('state', state); url.searchParams.set('code_challenge', challenge); url.searchParams.set('code_challenge_method', 'S256');
    return { authorizationUrl: url.toString() };
  }
  async oauthCallback(provider: string, state: string, code: string): Promise<never> {
    if (!code) throw new AppError('OAUTH_CALLBACK_INVALID', 'OAuth authorization code is required.', 400);
    const record = await this.oauthStates.findOneBy({ provider, stateHash: this.hashToken(state), usedAt: IsNull() });
    if (!record || record.expiresAt <= new Date()) throw new AppError('OAUTH_STATE_INVALID', 'OAuth state is invalid or expired.', 400);
    const used = await this.oauthStates.update({ id: record.id, usedAt: IsNull() }, { usedAt: new Date() });
    if (!used.affected) throw new AppError('OAUTH_STATE_INVALID', 'OAuth state was already used.', 400);
    // The provider exchange must be implemented by an adapter using record.codeVerifier and the provider token endpoint.
    throw new AppError('OAUTH_NOT_IMPLEMENTED', 'OAuth state and PKCE validation succeeded; configure a provider adapter for token exchange.', 501);
  }

  private async createAuthentication(user: User, metadata: RequestMetadata): Promise<AuthenticationResult> {
    const refreshToken = this.newOpaqueToken();
    await this.sessions.save(this.sessions.create({ id: this.sessionIdFromToken(refreshToken), userId: user.id, tokenHash: this.hashToken(refreshToken), expiresAt: new Date(Date.now() + this.config.get<number>('REFRESH_TOKEN_EXPIRE_DAYS', 30) * 86_400_000), revokedAt: null, replacedById: null, ipAddress: metadata.ip ?? null, userAgent: metadata.userAgent ?? null }));
    return { accessToken: await this.jwtService.signAsync({ sub: user.id }), refreshToken, user: UserPublicDto.fromEntity(user) };
  }
  private async createOneTimeToken(userId: string, kind: TokenKind): Promise<void> {
    await this.tokens.update({ userId, kind, usedAt: IsNull() }, { usedAt: new Date() });
    const raw = this.newOpaqueToken();
    await this.tokens.save(this.tokens.create({ userId, kind, tokenHash: this.hashToken(raw), usedAt: null, expiresAt: new Date(Date.now() + this.config.get<number>(kind === 'password_reset' ? 'PASSWORD_RESET_EXPIRE_MINUTES' : 'EMAIL_VERIFICATION_EXPIRE_MINUTES', 60) * 60_000) }));
    // A mail-provider adapter must deliver raw; raw tokens are intentionally never persisted or returned.
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
