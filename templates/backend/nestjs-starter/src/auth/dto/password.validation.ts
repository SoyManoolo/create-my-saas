import { applyDecorators } from '@nestjs/common';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Shared policy for registration, changes, and password-reset completion. */
export function IsApplicationPassword(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MinLength(8),
    MaxLength(128),
    Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'password must contain a letter and a number' }),
  );
}
