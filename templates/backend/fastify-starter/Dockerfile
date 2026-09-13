FROM node:22.14.0-bookworm-slim AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . ./
RUN pnpm build

FROM build AS migrate
CMD ["pnpm", "db:migrate"]

FROM node:22.14.0-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8000
RUN corepack enable && useradd --create-home --uid 10001 app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=app:app /app/dist ./dist
USER app
EXPOSE 8000
CMD ["node", "dist/server.js"]
