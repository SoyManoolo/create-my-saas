import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { AuthToken } from './auth-token.entity';
import { AuthService } from './auth.service';
import { OAuthAccount } from './oauth-account.entity';
import { OAuthState } from './oauth-state.entity';
import { RefreshSession } from './refresh-session.entity';
import { SecureEmailService } from './secure-email.service';

type OAuthExchange = {
  exchangeOAuthProfile: (
    provider: string,
    code: string,
    verifier: string,
    config: { clientId: string; clientSecret: string; tokenUrl: string; userInfoUrl: string; redirectUri: string },
  ) => Promise<unknown>;
  oauthJson: (url: string, options: RequestInit) => Promise<unknown>;
};

function service(): AuthService {
  return new AuthService(
    {} as UsersService,
    {} as JwtService,
    {} as ConfigService,
    {} as Repository<RefreshSession>,
    {} as Repository<AuthToken>,
    {} as Repository<OAuthState>,
    {} as Repository<OAuthAccount>,
    {} as DataSource,
    {} as SecureEmailService,
  );
}

describe('AuthService OAuth profiles', () => {
  it('rejects an unverified GitHub email returned by /user', async () => {
    const auth = service();
    const exchange = auth as unknown as OAuthExchange;
    const oauthJson = jest.spyOn(exchange, 'oauthJson')
      .mockResolvedValueOnce({ access_token: 'provider-token' })
      .mockResolvedValueOnce({ id: 42, email: 'person@example.com', login: 'octocat' })
      .mockResolvedValueOnce([{ email: 'person@example.com', primary: true, verified: false }]);

    await expect(exchange.exchangeOAuthProfile('github', 'code', 'verifier', {
      clientId: 'id', clientSecret: 'secret', tokenUrl: 'https://provider.test/token',
      userInfoUrl: 'https://provider.test/user', redirectUri: 'https://api.test/callback',
    })).rejects.toMatchObject({ code: 'OAUTH_EMAIL_UNVERIFIED' });

    expect(oauthJson).toHaveBeenLastCalledWith('https://api.github.com/user/emails', expect.any(Object));
  });
});
