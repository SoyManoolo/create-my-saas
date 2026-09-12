# Fastify SaaS starter

A TypeScript/Fastify API starter for browser-based SaaS applications. It keeps
refresh credentials out of JSON and browser storage as opaque, server-side
session values in an `HttpOnly` cookie. Login and refresh return a short-lived,
opaque `accessToken`; keep it in memory and send it as `Authorization: Bearer`
when calling protected endpoints. The frontend reads only the CSRF cookie and
sends it in `X-CSRF-Token` for refresh and logout requests.

## Start locally

```sh
cp .env.example .env
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm dev
```

The API listens on `http://localhost:3002`; `GET /health` is available without
authentication. PostgreSQL must be running at `DATABASE_URL` before migrating.

## Browser authentication contract

| Route | Behaviour |
| --- | --- |
| `POST /auth/register` | Creates an account; returns `{ user }`. |
| `POST /auth/login` | Creates an access and refresh session, sets cookies, and returns `{ accessToken, user }`. |
| `POST /auth/refresh` | Requires refresh cookie plus `X-CSRF-Token`; rotates both credentials and returns `{ accessToken, user }`. |
| `POST /auth/logout` | Requires CSRF, revokes the session, and clears cookies. |
| `GET /users/me` | Requires `Authorization: Bearer <accessToken>` and returns `{ user }`. |

`refresh_token` is scoped to `/auth` and `csrf_token` is intentionally readable
across `/` so an application route can call `/auth/refresh` or `/auth/logout`.
The `accessToken` is never persisted by the supplied contract: do not write it
to `localStorage`, a cookie, or server-rendered HTML. In production set
`COOKIE_SECURE=true` and use HTTPS origins in `CORS_ORIGINS`.

The included migration creates only users and refreshable browser sessions. Add
your own domain tables and migrations rather than storing application data in a
cookie or process memory.
