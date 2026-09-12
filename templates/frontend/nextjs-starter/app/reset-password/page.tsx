"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import styles from "../auth.module.css";
import { api, ApiError } from "../lib/api";

function ResetPasswordForm() {
  const params = useSearchParams();
  const token = params.get("token");
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    if (!token) { setError("El enlace de restablecimiento no es válido."); return; }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) { setError("La contraseña debe tener al menos 8 caracteres, una letra y un número."); return; }
    setError(undefined); setSubmitting(true);
    try { await api.resetPassword(token, password); setComplete(true); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "No se ha podido actualizar la contraseña."); }
    finally { setSubmitting(false); }
  }

  return <main className={styles.page}><section className={styles.box}><div className={styles.brand}><span>s</span>Starter</div><h1>Nueva contraseña</h1>{complete ? <><p>Tu contraseña se ha actualizado. Inicia sesión con la nueva contraseña.</p><p className={styles.footer}><Link href="/login">Iniciar sesión</Link></p></> : <><p>Elige una contraseña nueva y segura.</p><form className={styles.form} onSubmit={submit}><label>Nueva contraseña<input name="password" type="password" autoComplete="new-password" placeholder="8 caracteres, letra y número" required disabled={!token} /></label>{error && <p className={styles.error} role="alert">{error}</p>}<button type="submit" disabled={!token || submitting}>{submitting ? "Actualizando…" : "Actualizar contraseña"}</button></form></>}</section></main>;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<main className="page-status">Cargando…</main>}><ResetPasswordForm /></Suspense>;
}
