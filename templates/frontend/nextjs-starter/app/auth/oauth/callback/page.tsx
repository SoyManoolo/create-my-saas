"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../components/auth-provider";

export default function OAuthCallbackPage() {
  const router = useRouter();
  const { completeOAuth } = useAuth();
  const [error, setError] = useState<string>();
  useEffect(() => { void completeOAuth().then(() => router.replace("/")).catch(() => setError("No se ha podido completar el inicio de sesión. Vuelve a intentarlo.")); }, [completeOAuth, router]);
  return <main className="page-status" aria-live="polite">{error ?? "Completando inicio de sesión…"}</main>;
}
