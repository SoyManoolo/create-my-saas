import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "SaaS starter",
  description: "A reusable SaaS frontend foundation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="es"><body><Providers>{children}</Providers></body></html>;
}
