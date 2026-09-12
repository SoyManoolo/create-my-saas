import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedRoute } from "../components/protected-route";
import { useAuth } from "../lib/auth-context";

export function meta() { return [{ title: "Cuenta · SaaS starter" }]; }

export default function Account() {
  const { user, resendVerification } = useAuth();
  const [message, setMessage] = useState<string>();

  async function resend() {
    try { await resendVerification(); setMessage("Hemos enviado un nuevo enlace de verificación."); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se ha podido enviar el email."); }
  }

  return <ProtectedRoute><AppShell><main className="dashboard"><p className="eyebrow">CUENTA</p><h1>Tu perfil</h1><section className="account-card"><dl><div><dt>Nombre</dt><dd>{user?.name}</dd></div><div><dt>Email</dt><dd>{user?.email}</dd></div><div><dt>Estado</dt><dd>{user?.emailVerified ? "Email verificado" : "Pendiente de verificar"}</dd></div></dl>{!user?.emailVerified && <button className="button" type="button" onClick={resend}>Reenviar verificación</button>}{message && <p className="success">{message}</p>}</section></main></AppShell></ProtectedRoute>;
}
