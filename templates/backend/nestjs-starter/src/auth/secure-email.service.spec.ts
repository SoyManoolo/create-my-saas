import { ConfigService } from '@nestjs/config';
import { SecureEmailService } from './secure-email.service';

describe('SecureEmailService', () => {
  const service = (values: Record<string, string | undefined>) => new SecureEmailService({
    get: (name: string, fallback?: string) => values[name] ?? fallback,
  } as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it('posts the shared authenticated adapter contract', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const timeoutMock = jest.spyOn(AbortSignal, 'timeout');
    const email = service({
      NODE_ENV: 'test',
      EMAIL_DELIVERY_URL: 'https://mail.example.test/send',
      EMAIL_DELIVERY_TOKEN: 'delivery-token',
    });

    await email.send('person@example.com', 'Verify email', 'Use this one-time token');

    expect(fetchMock).toHaveBeenCalledWith('https://mail.example.test/send', expect.objectContaining({
      method: 'POST',
      headers: { Authorization: 'Bearer delivery-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: 'person@example.com', subject: 'Verify email', text: 'Use this one-time token' }),
    }));
    expect(timeoutMock).toHaveBeenCalledWith(10_000);
  });

  it('suppresses missing configuration only outside protected environments', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    await service({ NODE_ENV: 'development' }).send('person@example.com', 'Subject', 'Text');
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(service({ NODE_ENV: 'staging' }).send('person@example.com', 'Subject', 'Text')).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_UNAVAILABLE', statusCode: 503,
    });
  });

  it.each([
    ['adapter rejection', async () => ({ ok: false } as Response)],
    ['network failure', async () => { throw new TypeError('fetch failed'); }],
  ])('normalizes %s as EMAIL_DELIVERY_UNAVAILABLE', async (_name, implementation) => {
    jest.spyOn(globalThis, 'fetch').mockImplementation(implementation);
    const email = service({
      NODE_ENV: 'test',
      EMAIL_DELIVERY_URL: 'https://mail.example.test/send',
      EMAIL_DELIVERY_TOKEN: 'delivery-token',
    });

    await expect(email.send('person@example.com', 'Subject', 'Text')).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_UNAVAILABLE', statusCode: 503,
    });
  });
});
