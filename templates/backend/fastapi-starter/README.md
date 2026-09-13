# FastAPI SaaS starter

This template provides a modular SaaS API: password and token authentication, rotating
refresh sessions, one-use verification/recovery tokens, profiles, organizations with
RBAC invitations, organization audit logs, Stripe Checkout/Portal billing with verified webhooks, entitlements and trusted usage recording, and Redis-backed rate limiting.

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

Email endpoints never return opaque tokens. Configure `EMAIL_DELIVERY_URL` and
`EMAIL_DELIVERY_TOKEN` to send reset, verification, and invitation links through the
shared authenticated HTTPS adapter; production and staging refuse to start without
them. The adapter receives `POST` JSON `{ to, subject, text }` with a Bearer token and
a 10-second timeout. In development and tests, leaving both values empty suppresses
delivery. Google and GitHub OAuth use signed state, PKCE and verified provider
email; callbacks write the refresh credential only as an HttpOnly cookie before a
token-free redirect to the frontend. Provider client credentials remain environment
values. Redis is installed by default. Production and staging require
an available `rediss://` endpoint; development can fall back to an in-process limiter
when Redis is deliberately unavailable.

## Sensitive-action audit log

FastAPI records successful invitation creation/acceptance, role changes, member
removal, ownership transfers, and Stripe Checkout/Portal creation in the
append-only `audit_logs` table. Owners and administrators can read the newest
events through `GET /organizations/{organizationId}/audit-logs`; `limit` is 50
by default (100 maximum) and `cursor` continues from `nextCursor`.

Each event stores the organization, actor, action, target, timestamp, and only
action-specific allowlisted metadata. Invitation tokens and hashes, request
bodies, credentials, Stripe customer/session/subscription IDs, payment methods,
and card data are never audit metadata. The invited email is retained for
incident investigation, so define retention/export rules appropriate to the
product before using the log for enterprise or compliance purposes.
