import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const baseUrl = site ?? new URL('https://example.com');
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${new URL('sitemap-index.xml', baseUrl)}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
