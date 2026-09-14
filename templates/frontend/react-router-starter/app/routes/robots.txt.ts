import { absoluteUrl } from "../lib/seo";

export function loader() {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${absoluteUrl("/sitemap.xml")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
