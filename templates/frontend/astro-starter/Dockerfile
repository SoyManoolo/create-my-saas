FROM node:22.14.0-bookworm-slim AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

WORKDIR /app
ARG PUBLIC_SITE_URL=https://example.com
ARG PUBLIC_API_BASE_URL=
ENV PUBLIC_SITE_URL=$PUBLIC_SITE_URL \
    PUBLIC_API_BASE_URL=$PUBLIC_API_BASE_URL
COPY . ./
RUN pnpm build

FROM nginx:1.27.4-alpine-slim AS runtime

COPY deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 3000
