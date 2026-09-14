import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, api } from "../lib/api.client";
import { privatePageMetadata } from "../lib/seo";

export function meta() { return privatePageMetadata({ title: "Restablecer contraseña | SaaS starter", description: "Elige una contraseña nueva para tu cuenta.", path: "/reset-password" }); }

export default function ResetPassword() {
  const [search] = useSearchParams();
  const token = search.get("token");
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    const password = String(new FormData(event.currentTarget).get("password"));
    setError(undefined); setPending(true);
    try { await api.resetPassword(token, password); setDone(true); } catch (cause) { setError(cause instanceof ApiError ? cause.message : "No se ha podido actualizar la contraseña."); } finally { setPending(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand" to="/"><span>✦</span> SaaS starter</Link><h1>Nueva contraseña</h1>{!token ? <p className="error" role="alert">El enlace no incluye un token de recuperación válido.</p> : done ? <p className="success">Contraseña actualizada. <Link to="/login">Ya puedes entrar.</Link></p> : <form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}<label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label><button className="button" disabled={pending}>{pending ? "Actualizando…" : "Actualizar contraseña"}</button></form>}</section></main>;
}
