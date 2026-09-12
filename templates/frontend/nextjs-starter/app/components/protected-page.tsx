"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./auth-provider";

export function ProtectedPage({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { status } = useAuth();

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [router, status]);

  if (status !== "authenticated") return <main className="page-status" aria-live="polite">Comprobando tu sesión…</main>;
  return <>{children}</>;
}
