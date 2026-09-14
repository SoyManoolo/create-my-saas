import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { AuthProvider } from "./lib/auth-context";
import { PostHogProvider } from "./components/posthog-provider";
import "./styles.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <PostHogProvider><AuthProvider><Outlet /></AuthProvider></PostHogProvider>;
}
