const defaultSiteUrl = "https://example.com";

export function absoluteUrl(path = "/") {
  return new URL(path, import.meta.env.VITE_PUBLIC_SITE_URL ?? defaultSiteUrl).toString();
}

type PageMetadata = {
  title: string;
  description: string;
  path: string;
};

function metadata({ title, description, path }: PageMetadata) {
  const url = absoluteUrl(path);

  return [
    { title },
    { name: "description", content: description },
    { tagName: "link" as const, rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:locale", content: "es_ES" },
    { property: "og:site_name", content: "SaaS starter" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: url },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
  ];
}

export function publicPageMetadata(page: PageMetadata) {
  return metadata(page);
}

export function privatePageMetadata(page: PageMetadata) {
  return [
    ...metadata(page),
    { name: "robots", content: "noindex, nofollow, noarchive" },
  ];
}
