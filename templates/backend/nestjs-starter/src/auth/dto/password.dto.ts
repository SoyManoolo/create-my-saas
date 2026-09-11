import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsApplicationPassword } from './password.validation';
export class ChangePasswordDto { @IsString() currentPassword!: string; @IsApplicationPassword() newPassword!: string; }
export class RequestPasswordResetDto { @IsEmail() email!: string; }
export class ResetPasswordDto { @IsString() @MinLength(20) token!: string; @IsApplicationPassword() newPassword!: string; }
