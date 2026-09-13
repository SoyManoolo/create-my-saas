FROM python:3.13.3-slim-bookworm AS builder

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONDONTWRITEBYTECODE=1

RUN pip install --no-cache-dir uv==0.7.4
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY . ./

FROM builder AS migrate
CMD ["./.venv/bin/alembic", "upgrade", "head"]

FROM python:3.13.3-slim-bookworm AS runtime

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

RUN useradd --create-home --uid 10001 app
COPY --from=builder --chown=app:app /app /app
USER app
EXPOSE 8000
CMD ["sh", "-c", "exec fastapi run main.py --host 0.0.0.0 --port \"${PORT}\""]
