import { SetMetadata } from '@nestjs/common';

export const AUTH_RATE_LIMIT_BUCKET = 'auth-rate-limit-bucket';
export const AuthRateLimit = (bucket: string) => SetMetadata(AUTH_RATE_LIMIT_BUCKET, bucket);
