import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { ApiError, api } from "../lib/api.client";
import { privatePageMetadata } from "../lib/seo";

export function meta() { return privatePageMetadata({ title: "Recuperar cuenta | SaaS starter", description: "Solicita un enlace para restablecer tu contraseña.", path: "/forgot-password" }); }

export default function ForgotPassword() {
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setError(undefined); setPending(true);
    try { await api.requestPasswordReset(email); setSent(true); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "No se ha podido solicitar la recuperación."); } finally { setPending(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand" to="/"><span>✦</span> SaaS starter</Link><h1>Recupera tu cuenta</h1>{sent ? <p className="success">Si existe una cuenta con ese email, recibirás instrucciones para restablecer la contraseña.</p> : <><p>Te enviaremos un enlace de recuperación.</p><form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}<label>Email<input name="email" type="email" autoComplete="email" required /></label><button className="button" disabled={pending}>{pending ? "Enviando…" : "Enviar instrucciones"}</button></form></>}<p className="form-footer"><Link to="/login">Volver a entrar</Link></p></section></main>;
}
