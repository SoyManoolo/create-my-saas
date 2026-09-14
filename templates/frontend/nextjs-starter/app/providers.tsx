"use client";

import type { ReactNode } from "react";
import { AuthProvider } from "./components/auth-provider";
import { PostHogProvider } from "./components/posthog-provider";

export function Providers({ children }: { children: ReactNode }) {
  return <PostHogProvider><AuthProvider>{children}</AuthProvider></PostHogProvider>;
}
