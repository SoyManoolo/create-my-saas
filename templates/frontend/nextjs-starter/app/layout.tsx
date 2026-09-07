import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nexa | Workspace",
  description: "A reusable SaaS dashboard foundation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return <html lang="es" className={geist.variable}><body>{children}</body></html>;
}
