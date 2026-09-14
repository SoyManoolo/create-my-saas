import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://example.com");

export const metadata: Metadata = {
  metadataBase: siteUrl,
  applicationName: "SaaS starter",
  title: {
    default: "SaaS starter",
    template: "%s | SaaS starter",
  },
  description: "Una base reutilizable para la aplicación autenticada de tu SaaS.",
  openGraph: {
    type: "website",
    locale: "es_ES",
    siteName: "SaaS starter",
    title: "SaaS starter",
    description: "Una base reutilizable para la aplicación autenticada de tu SaaS.",
  },
  twitter: {
    card: "summary",
    title: "SaaS starter",
    description: "Una base reutilizable para la aplicación autenticada de tu SaaS.",
  },
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
      "max-image-preview": "none",
    },
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="es"><body><Providers>{children}</Providers></body></html>;
}
