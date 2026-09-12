"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import styles from "../auth.module.css";
import { ApiError } from "../lib/api";
import { useAuth } from "../components/auth-provider";
import { OAuthButtons } from "../components/oauth-buttons";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, status } = useAuth();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [router, status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError(undefined);
    setSubmitting(true);
    try {
      await signIn(String(values.get("email")), String(values.get("password")));
      router.replace("/");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "No se ha podido iniciar sesión.");
    } finally { setSubmitting(false); }
  }

  if (status === "authenticated") return <main className="page-status">Redirigiendo…</main>;
  return <main className={styles.page}><section className={styles.box}><div className={styles.brand}><span>s</span>Starter</div><h1>Inicia sesión</h1><p>Accede a tu espacio de trabajo.</p><form className={styles.form} onSubmit={submit}><label>Correo electrónico<input name="email" type="email" autoComplete="email" placeholder="tu@empresa.com" required /></label><label>Contraseña<input name="password" type="password" autoComplete="current-password" placeholder="••••••••" required /></label>{error && <p className={styles.error} role="alert">{error}</p>}<button type="submit" disabled={submitting}>{submitting ? "Iniciando sesión…" : "Iniciar sesión"}</button></form><OAuthButtons /><p className={styles.footer}><Link href="/forgot-password">¿Has olvidado tu contraseña?</Link></p><p className={styles.footer}>¿Aún no tienes cuenta? <Link href="/register">Crear cuenta</Link></p></section></main>;
}
