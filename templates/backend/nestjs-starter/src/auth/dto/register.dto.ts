import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { IsApplicationPassword } from './password.validation';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsApplicationPassword()
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}
