import { IsEmail, IsString, MinLength } from 'class-validator';
export class ChangePasswordDto { @IsString() currentPassword!: string; @IsString() @MinLength(8) newPassword!: string; }
export class RequestPasswordResetDto { @IsEmail() email!: string; }
export class ResetPasswordDto { @IsString() @MinLength(20) token!: string; @IsString() @MinLength(8) newPassword!: string; }
