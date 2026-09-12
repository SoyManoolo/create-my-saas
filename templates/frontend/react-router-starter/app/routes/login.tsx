import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../lib/api.client";
import { useAuth } from "../lib/auth-context";
import { OAuthButtons } from "../components/oauth-buttons";

export function meta() { return [{ title: "Entrar · SaaS starter" }]; }

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(undefined); setPending(true);
    try {
      await signIn(String(data.get("email")), String(data.get("password")));
      const next = search.get("next");
      navigate(next?.startsWith("/") ? next : "/app", { replace: true });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se ha podido iniciar sesión.");
    } finally { setPending(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Link className="brand" to="/"><span>✦</span> SaaS starter</Link><h1>Bienvenido de nuevo</h1><p>Accede a tu espacio de trabajo.</p><form onSubmit={submit}>{error && <p className="error" role="alert">{error}</p>}<label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label><button className="button" disabled={pending}>{pending ? "Entrando…" : "Entrar"}</button></form><OAuthButtons /><p className="form-footer"><Link to="/forgot-password">¿Has olvidado la contraseña?</Link><br />¿Aún no tienes cuenta? <Link to="/register">Regístrate</Link></p></section></main>;
}
