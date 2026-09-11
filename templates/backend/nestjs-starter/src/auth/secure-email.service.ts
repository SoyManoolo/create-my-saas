import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../common/errors/app.error';

/** Sends mail only through an authenticated HTTPS transactional-email adapter. */
@Injectable()
export class SecureEmailService {
  constructor(private readonly config: ConfigService) {}

  async send(recipient: string, subject: string, text: string): Promise<void> {
    const url = this.config.get<string>('EMAIL_DELIVERY_URL');
    const token = this.config.get<string>('EMAIL_DELIVERY_TOKEN');
    if (!url || !token) {
      if (['production', 'staging'].includes(this.config.get<string>('NODE_ENV', 'development'))) {
        throw new AppError('EMAIL_DELIVERY_UNAVAILABLE', 'Secure email delivery is not configured.', 503);
      }
      return;
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: recipient, subject, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new AppError('EMAIL_DELIVERY_UNAVAILABLE', 'Secure email delivery is unavailable.', 503);
  }
}
