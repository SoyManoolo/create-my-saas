import { absoluteUrl } from "../lib/seo";

export function loader() {
  const homeUrl = absoluteUrl("/").replace(/&/g, "&amp;");
  const document = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url>\n    <loc>${homeUrl}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n</urlset>\n`;

  return new Response(document, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
