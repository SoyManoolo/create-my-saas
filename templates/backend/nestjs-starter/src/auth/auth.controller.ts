import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { AppError } from '../common/errors/app.error';
import { UserPublicDto } from '../users/dto/user-public.dto';
import { User } from '../users/user.entity';
import { CurrentUser } from './current-user.decorator';
import { AuthService, AuthenticationResult, BrowserAuthenticationResult } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto, RequestPasswordResetDto, ResetPasswordDto } from './dto/password.dto';
import { VerifyEmailDto } from './dto/verification.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly config: ConfigService) {}
  @Post('register') @UseGuards(RateLimitGuard)
  register(@Body() body: RegisterDto): Promise<UserPublicDto> { return this.authService.register(body); }
  @Post('login') @HttpCode(HttpStatus.OK) @UseGuards(RateLimitGuard)
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) response: Response): Promise<AuthenticationResult> {
    return this.setBrowserSession(response, await this.authService.login(body, this.metadata(req)));
  }
  @Post('refresh') @HttpCode(HttpStatus.OK) @UseGuards(RateLimitGuard)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) response: Response): Promise<AuthenticationResult> {
    this.requireCsrf(req);
    return this.setBrowserSession(response, await this.authService.refresh(this.cookie(req, this.refreshCookieName()), this.metadata(req)));
  }
  @Post('logout') @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    this.requireCsrf(req);
    await this.authService.logout(this.cookie(req, this.refreshCookieName()));
    response.clearCookie(this.refreshCookieName(), this.cookieOptions(true));
    response.clearCookie(this.csrfCookieName(), this.cookieOptions(false));
  }
  @Post('password/change') @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(JwtAuthGuard)
  async changePassword(@CurrentUser() user: User, @Body() body: ChangePasswordDto): Promise<void> { await this.authService.changePassword(user, body.currentPassword, body.newPassword); }
  @Post('password/reset/request') @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(RateLimitGuard)
  async requestReset(@Body() body: RequestPasswordResetDto): Promise<void> { await this.authService.requestPasswordReset(body.email.toLowerCase()); }
  @Post('password/reset/confirm') @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(RateLimitGuard)
  async reset(@Body() body: ResetPasswordDto): Promise<void> { await this.authService.resetPassword(body.token, body.newPassword); }
  @Post('email/verify') @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(RateLimitGuard)
  async verify(@Body() body: VerifyEmailDto): Promise<void> { await this.authService.verifyEmail(body.token); }
  @Post('email/resend') @HttpCode(HttpStatus.NO_CONTENT) @UseGuards(JwtAuthGuard, RateLimitGuard)
  async resend(@CurrentUser() user: User): Promise<void> { await this.authService.resendEmailVerification(user); }
  @Get('oauth/providers') providers(): Array<{ provider: string; configured: boolean }> { return this.authService.oauthProviders(); }
  @Get('oauth/:provider') startOAuth(@Param('provider') provider: string): Promise<{ authorizationUrl: string }> { return this.authService.oauthStart(provider); }
  @Get('oauth/:provider/callback') callbackOAuth(@Param('provider') provider: string, @Query('state') state: string, @Query('code') code: string): Promise<never> { return this.authService.oauthCallback(provider, state, code); }
  private metadata(req: Request): { ip?: string; userAgent?: string } { return { ip: req.ip, userAgent: req.header('user-agent') }; }
  private refreshCookieName(): string { return this.config.get<string>('REFRESH_COOKIE_NAME', 'refresh_token'); }
  private csrfCookieName(): string { return this.config.get<string>('CSRF_COOKIE_NAME', 'csrf_token'); }
  private cookieOptions(httpOnly: boolean): { httpOnly: boolean; secure: boolean; sameSite: 'lax' | 'strict' | 'none'; path: string; maxAge?: number } {
    const sameSite = this.config.get<string>('COOKIE_SAME_SITE', 'lax') as 'lax' | 'strict' | 'none';
    return { httpOnly, secure: this.config.get<boolean>('COOKIE_SECURE', false), sameSite, path: '/auth', maxAge: this.config.get<number>('REFRESH_TOKEN_EXPIRE_DAYS', 30) * 86_400_000 };
  }
  private setBrowserSession(response: Response, session: BrowserAuthenticationResult): AuthenticationResult {
    response.cookie(this.refreshCookieName(), session.refreshToken, this.cookieOptions(true));
    response.cookie(this.csrfCookieName(), randomBytes(32).toString('base64url'), this.cookieOptions(false));
    return session.authentication;
  }
  private cookie(req: Request, name: string): string {
    return req.headers.cookie?.split(';').map((part) => part.trim().split('=', 2)).find(([key]) => key === name)?.[1] ?? '';
  }
  private requireCsrf(req: Request): void {
    const cookie = this.cookie(req, this.csrfCookieName()); const supplied = req.header('x-csrf-token') ?? '';
    if (!cookie || cookie.length !== supplied.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(supplied))) {
      throw new AppError('INVALID_CSRF_TOKEN', 'CSRF token is missing or invalid.', 403);
    }
  }
}
