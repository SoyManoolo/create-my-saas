import { createHash } from 'node:crypto';
import type { Config } from '../config.js';
import { AppError } from '../http/errors.js';

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  redirectUri: string;
  scopes: string;
};

const oauthDefaults = {
  google: {
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scopes: 'openid email profile',
  },
  github: {
    authorizationUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: 'read:user user:email',
  },
} as const;

export function getOAuthConfig(config: Config, provider: string): OAuthProviderConfig | undefined {
  if (!config.OAUTH_ENABLED || !(provider in oauthDefaults)) return undefined;
  const key = provider.toUpperCase() as 'GOOGLE' | 'GITHUB';
  const defaults = oauthDefaults[provider as keyof typeof oauthDefaults];
  const clientId = config[`OAUTH_${key}_CLIENT_ID`];
  const clientSecret = config[`OAUTH_${key}_CLIENT_SECRET`];
  const redirectUri = config[`OAUTH_${key}_REDIRECT_URI`];
  if (!clientId || !clientSecret || !redirectUri) return undefined;
  return {
    clientId,
    clientSecret,
    redirectUri,
    authorizationUrl: config[`OAUTH_${key}_AUTHORIZATION_URL`] ?? defaults.authorizationUrl,
    tokenUrl: config[`OAUTH_${key}_TOKEN_URL`] ?? defaults.tokenUrl,
    userInfoUrl: config[`OAUTH_${key}_USERINFO_URL`] ?? defaults.userInfoUrl,
    scopes: config[`OAUTH_${key}_SCOPES`] ?? defaults.scopes,
  };
}

export function buildAuthorizationUrl(config: OAuthProviderConfig, state: string, verifier: string): string {
  const url = new URL(config.authorizationUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function oauthJson(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.');
  }
  if (!response.ok) throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider could not complete sign-in.');
  try {
    return await response.json();
  } catch {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider returned an invalid response.');
  }
}

export async function exchangeOAuthProfile(
  provider: string,
  code: string,
  verifier: string,
  config: OAuthProviderConfig,
): Promise<{ email: string; name: string }> {
  const token = await oauthJson(config.tokenUrl, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code_verifier: verifier,
    }),
  }) as Record<string, unknown>;
  if (typeof token.access_token !== 'string' || !token.access_token) {
    throw new AppError(502, 'OAUTH_PROVIDER_ERROR', 'The OAuth provider did not return an access token.');
  }
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json', 'User-Agent': 'create-my-saas' };
  const profile = await oauthJson(config.userInfoUrl, { headers }) as Record<string, unknown>;
  if (provider === 'github' && !profile.email) {
    const emails = await oauthJson('https://api.github.com/user/emails', { headers });
    if (Array.isArray(emails)) {
      profile.email = (emails as Array<Record<string, unknown>>).find((entry) => entry.primary === true && entry.verified === true)?.email;
    }
  }
  const verified = provider === 'google' ? profile.email_verified === true : Boolean(profile.email);
  if (typeof profile.email !== 'string' || !profile.email || !verified) {
    throw new AppError(400, 'OAUTH_EMAIL_UNVERIFIED', 'The OAuth provider did not provide a verified email address.');
  }
  return {
    email: profile.email.toLowerCase(),
    name: String(profile.name ?? profile.login ?? profile.email.split('@')[0]).slice(0, 120),
  };
}
