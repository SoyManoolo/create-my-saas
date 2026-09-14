import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError, api } from "../lib/api.client";
import { OAuthButtons } from `../components/oauth-buttons`;
import { captureAnalyticsEvent } from `../components/posthog-provider`;

export function meta() { return [{ title: "Crear cuenta · SaaS starter" }]; }

export default function Register() {
  const navigate = useNavigate();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(undefined); setPending(true);
    try {
      await api.register({ name: String(data.get("name")), email: String(data.get("email")), password: String(data.get("password")) });
      captureAnalyticsEvent("signup_requested");
      navigate("/login?registered=1", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se ha podido crear la cuenta.");
    } finally { setPending(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand" to="/"><span>✦</span> SaaS starter</Link><h1>Crea tu cuenta</h1><p>La contraseña debe tener al menos ocho caracteres, una letra y un número.</p><form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}<label>Nombre<input name="name" autoComplete="name" required /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Contraseña<input name="password" type="password" autoComplete="new-password" minLength={8} required /></label><button className="button" disabled={pending}>{pending ? "Creando…" : "Crear cuenta"}</button></form><OAuthButtons /><p className="form-footer">¿Ya tienes cuenta? <Link to="/login">Entra</Link></p></section></main>;
}
