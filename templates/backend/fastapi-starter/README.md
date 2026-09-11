# FastAPI SaaS starter

This template provides a modular SaaS API: password and token authentication, rotating
refresh sessions, one-use verification/recovery tokens, profiles, organizations with
RBAC invitations, a provider-agnostic billing domain, and optional rate limiting.

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

## Integration boundaries

Email endpoints never return opaque tokens. Configure the secure SMTP settings to send
reset, verification, and invitation links; production and staging refuse to start
without them. OAuth start/callback implements signed state and PKCE but
leaves code exchange/profile mapping to a provider adapter; provider client credentials
remain environment values. For a shared application-side limiter, install the optional
extra (`uv sync --extra rate-limit`) and set `REDIS_URL`; otherwise the configured
in-memory limiter is appropriate for a single process only.
