import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";

export default function OAuthCallback() {
  const navigate = useNavigate();
  const { completeOAuth } = useAuth();
  const [error, setError] = useState<string>();
  useEffect(() => { void completeOAuth().then(() => navigate("/app", { replace: true })).catch(() => setError("No se ha podido completar el inicio de sesión. Vuelve a intentarlo.")); }, [completeOAuth, navigate]);
  return <main className="page-status" aria-live="polite">{error ?? "Completando inicio de sesión…"}</main>;
}
