import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard';
import { UserPublicDto } from '../users/dto/user-public.dto';
import { User } from '../users/user.entity';
import { CurrentUser } from './current-user.decorator';
import { AuthService, AuthenticationResult } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ChangePasswordDto, RequestPasswordResetDto, ResetPasswordDto } from './dto/password.dto';
import { VerifyEmailDto } from './dto/verification.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('register') @UseGuards(RateLimitGuard)
  register(@Body() body: RegisterDto): Promise<UserPublicDto> { return this.authService.register(body); }
  @Post('login') @HttpCode(HttpStatus.OK) @UseGuards(RateLimitGuard)
  login(@Body() body: LoginDto, @Req() req: Request): Promise<AuthenticationResult> { return this.authService.login(body, this.metadata(req)); }
  @Post('refresh') @HttpCode(HttpStatus.OK) @UseGuards(RateLimitGuard)
  refresh(@Body() body: RefreshDto, @Req() req: Request): Promise<AuthenticationResult> { return this.authService.refresh(body.refreshToken, this.metadata(req)); }
  @Post('logout') @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() body: Partial<RefreshDto>): Promise<void> { await this.authService.logout(body.refreshToken); }
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
}
