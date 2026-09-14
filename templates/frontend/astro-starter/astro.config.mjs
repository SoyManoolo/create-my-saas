import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { existsSync, readFileSync } from 'node:fs';

function localEnvironment() {
  if (!existsSync('.env')) return {};
  return Object.fromEntries(readFileSync('.env', 'utf8').split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    return match ? [[match[1], match[2]]] : [];
  }));
}

export default defineConfig(() => {
  const values = localEnvironment();
  const environment = { ...values, ...process.env };
  const site = environment.PUBLIC_SITE_URL ?? 'https://example.com';
  const apiTarget = environment.API_PROXY_TARGET?.replace(/\/$/, '');
  const noindexPaths = new Set([
    '/account/',
    '/app/',
    '/auth/oauth/callback/',
    '/forgot-password/',
    '/login/',
    '/register/',
    '/reset-password/',
    '/verify-email/',
  ]);
  return {
    site,
    integrations: [sitemap({ filter: (page) => !noindexPaths.has(new URL(page).pathname) })],
    vite: apiTarget ? {
      server: {
        proxy: {
          '/auth': apiTarget,
          '/users': apiTarget,
        },
      },
    } : undefined,
  };
});
