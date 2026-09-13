# FastAPI SaaS starter

This template provides a modular SaaS API: password and token authentication, rotating
refresh sessions, one-use verification/recovery tokens, profiles, organizations with
RBAC invitations, Stripe Checkout/Portal billing with verified webhooks, entitlements and trusted usage recording, and Redis-backed rate limiting.

## Run it

Copy `.env.example` to `.env`, set a real `SECRET_KEY` and database URL, then install
the project dependencies with `uv sync`. Apply the initial schema with:

```sh
uv run alembic upgrade head
uv run fastapi dev main.py
```

Run the dependency-free test entry point after syncing with:

```sh
uv run python -m unittest discover -s tests
```

## Infrastructure contract

See [`../backend-infrastructure-contract.md`](../backend-infrastructure-contract.md) for
the settings and operational behavior shared with the Nest starter. FastAPI connects to
PostgreSQL through `postgresql+asyncpg://`; migrations intentionally use the synchronous
`postgresql+psycopg://` driver because Alembic executes schema DDL synchronously.
`GET /health` is a dependency-free liveness probe. `GET /ready` checks
PostgreSQL and, when rate limiting is enabled, Redis; failed or timed-out
dependencies return a structured `503 SERVICE_NOT_READY` response.

`TRUST_PROXY_HEADERS` is off by default. Enable it only with explicit
`TRUSTED_PROXY_IPS`; then Uvicorn accepts `X-Forwarded-For` and
`X-Forwarded-Proto` only from those peers, and the rate limiter uses that validated client
IP. Do not enable it with a wildcard.

## Integration boundaries

Email endpoints never return opaque tokens. Configure the secure SMTP settings to send
reset, verification, and invitation links; production and staging refuse to start
without them. Google and GitHub OAuth use signed state, PKCE and verified provider
email; callbacks write the refresh credential only as an HttpOnly cookie before a
token-free redirect to the frontend. Provider client credentials remain environment
values. Redis is installed by default. Production and staging require
an available `rediss://` endpoint; development can fall back to an in-process limiter
when Redis is deliberately unavailable.
