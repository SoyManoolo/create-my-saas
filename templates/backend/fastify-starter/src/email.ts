import type { Config } from './config.js';

export class EmailDeliveryError extends Error {
  constructor() {
    super('Secure email delivery is unavailable.');
  }
}

export interface EmailSender {
  send(recipient: string, subject: string, text: string): Promise<void>;
}

/** Sends mail through an authenticated HTTPS transactional-email adapter. */
export class SecureEmailSender implements EmailSender {
  constructor(private readonly config: Config) {}

  async send(recipient: string, subject: string, text: string): Promise<void> {
    const { EMAIL_DELIVERY_URL: url, EMAIL_DELIVERY_TOKEN: token } = this.config;
    if (!url || !token) {
      if (this.config.NODE_ENV === 'production') throw new EmailDeliveryError();
      return;
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: recipient, subject, text }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new EmailDeliveryError();
    } catch (error) {
      if (error instanceof EmailDeliveryError) throw error;
      throw new EmailDeliveryError();
    }
  }
}
