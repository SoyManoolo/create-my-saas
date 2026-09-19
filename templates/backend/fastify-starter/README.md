# Fastify SaaS starter

A TypeScript/Fastify API starter for browser-based SaaS applications. It keeps
refresh credentials out of JSON and browser storage as opaque, server-side
session values in an `HttpOnly` cookie. Login and refresh return a short-lived,
opaque `accessToken`; keep it in memory and send it as `Authorization: Bearer`
when calling protected endpoints. The frontend reads only the CSRF cookie and
sends it in `X-CSRF-Token` for refresh and logout requests.

## Capacidades y compatibilidad

Fastify implementa las capacidades declaradas en `template.manifest.json`:
sesiones de navegador, recuperación, verificación de correo, OAuth Google/GitHub,
CSRF, PostgreSQL, migraciones, correo transaccional y rate limiting. Es
compatible con Astro en su área autenticada ligera.

## Requisitos

- Node.js 20 o posterior y pnpm.
- PostgreSQL accesible mediante `DATABASE_URL`.
- Redis para límites compartidos en staging y producción.

## Desarrollo local

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The API listens on `http://localhost:3002`; `GET /health` is a
dependency-free liveness probe. `GET /ready` checks PostgreSQL and, when rate
limiting is enabled, Redis with a short timeout. Unavailable required
dependencies return a structured `503 SERVICE_NOT_READY` response.
PostgreSQL must be running at `DATABASE_URL` before migrating.
Set `DATABASE_SSL=true` with a certificate-verifying PostgreSQL endpoint in
staging and production; the process refuses to start without it.

## Configuración

Copia `.env.example` a `.env`. `DATABASE_URL`, `SECRET_KEY`, `FRONTEND_URL` y
`CORS_ORIGINS` son obligatorias. Configura correo, OAuth, Redis y cookies con las
variables de `.env.example` antes de activarlos fuera de desarrollo.

## Verificación

```sh
pnpm typecheck
pnpm test
```

## Rate limiting and proxies

Requests except `GET /health` and `GET /ready` are limited by client IP, HTTP method and route.
The shared settings are `RATE_LIMIT_ENABLED`, `RATE_LIMIT_REQUESTS` (default
`30`), `RATE_LIMIT_WINDOW_SECONDS` (default `60`), `RATE_LIMIT_PREFIX`, and
`REDIS_URL`. Login, registration, password-reset requests, and reset
confirmation each use an independent bucket with
`AUTH_RATE_LIMIT_REQUESTS` (default `5`) and
`AUTH_RATE_LIMIT_WINDOW_SECONDS` (default `60`). Redis is used for a counter shared by every worker; local
development and test can fall back to memory if Redis is unavailable. Staging
and production require `RATE_LIMIT_ENABLED=true` and a TLS `rediss://` URL;
an unavailable store returns `503 RATE_LIMIT_UNAVAILABLE`, while an exceeded
limit returns `429 RATE_LIMITED` with `Retry-After`.

By default the socket IP is used. Set `TRUST_PROXY_HEADERS=true` only with
explicit `TRUSTED_PROXY_IPS`; Fastify then accepts forwarded client identity
only from those peers. Never use `*`: the proxy must discard incoming
forwarding headers and reconstruct them itself.

## Browser authentication contract

| Route | Behaviour |
| --- | --- |
| `POST /auth/register` | Creates an account; returns `{ user }`. |
| `POST /auth/login` | Creates an access and refresh session, sets cookies, and returns `{ accessToken, user }`. |
| `POST /auth/refresh` | Requires refresh cookie plus `X-CSRF-Token`; rotates both credentials and returns `{ accessToken, user }`. |
| `POST /auth/logout` | Requires CSRF, revokes the session, and clears cookies. |
| `GET /users/me` | Requires `Authorization: Bearer <accessToken>` and returns `{ user }`. |
| `POST /auth/password/reset/request` | Always returns `204`; if an active account exists, sends a reset link without exposing a token or account existence. |
| `POST /auth/password/reset/confirm` | Consumes a one-use reset token, changes the password, and revokes all browser sessions. |
| `POST /auth/email/verify` | Consumes a one-use verification token and marks the email verified. |
| `POST /auth/email/resend` | Requires an access token and sends a replacement verification link when needed. |
| `GET /auth/oauth/providers` | Lists Google and GitHub and whether each is configured. |
| `GET /auth/oauth/:provider` | Creates a server-side PKCE state and returns `{ authorizationUrl }`. |
| `GET /auth/oauth/:provider/start` | Browser redirect variant of the previous route. |
| `GET /auth/oauth/:provider/callback` | Consumes PKCE state, resolves the immutable provider account, sets browser cookies, then redirects to the frontend callback. |

`refresh_token` is scoped to `/auth` and `csrf_token` is intentionally readable
across `/` so an application route can call `/auth/refresh` or `/auth/logout`.
The `accessToken` is never persisted by the supplied contract: do not write it
to `localStorage`, a cookie, or server-rendered HTML. In production set
`COOKIE_SECURE=true` and use HTTPS origins in `CORS_ORIGINS`.

Every failed API response uses `{ "error": { "code", "message" } }`, matching
the other backend starters.

## Account recovery, email verification and OAuth

Registration sends a verification link. Password-reset requests deliberately
return `204` for both known and unknown addresses, and neither API response
contains a raw token. Reset and verification tokens are 48-byte opaque values;
only their SHA-256 hashes are stored, each expires, and consuming a token is an
atomic one-time operation. Issuing a replacement invalidates the outstanding
token of the same kind. A successful password reset revokes every browser
session for that user.

Email is delivered through the authenticated HTTPS adapter configured by
`EMAIL_DELIVERY_URL` and `EMAIL_DELIVERY_TOKEN`. Delivery is a no-op locally so
the starter can run without external services; staging and production require an HTTPS URL
and token and fails closed if delivery is unavailable. Connect this endpoint to
your transactional provider or a small provider-specific adapter that accepts
`{ to, subject, text }` with a bearer token.

OAuth supports Google and GitHub authorization-code flow with PKCE. Enable it
only after configuring a client ID, secret and registered callback URI for the
provider. `state` is stored only as a hash; the code verifier remains server
side, expires in ten minutes and can be consumed once. Google must assert a
verified email; GitHub verifies the profile email against its verified-email
endpoint. OAuth users are automatically marked as email verified.
The first verified sign-in links the provider subject to a local user in
`oauth_accounts`; subsequent sign-ins use that stable link rather than email.
If a provider subject and a local email resolve to different users, the callback
returns `OAUTH_ACCOUNT_CONFLICT` instead of merging accounts.

These authentication flows intentionally live only in this backend starter and
its API contract. They do not add, change, or assume any dashboard screens.

The included migrations create users, refreshable browser sessions, one-time
authentication tokens and OAuth states. Add your own domain tables and
migrations rather than storing application data in a cookie or process memory.

## Límites deliberados

No incluye organizaciones, RBAC ni Stripe Billing. Añade las entidades de
producto mediante migraciones propias, sin almacenar datos de dominio en cookies
ni en memoria de proceso.
