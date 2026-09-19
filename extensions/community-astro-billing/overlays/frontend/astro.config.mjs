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
  return {
    site,
    integrations: [sitemap()],
    vite: apiTarget ? {
      server: {
        proxy: {
          '/auth': apiTarget,
          '/users': apiTarget,
          '/organizations': apiTarget,
          '/billing': apiTarget,
        },
      },
    } : undefined,
  };
});
