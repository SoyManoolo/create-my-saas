"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import styles from "../auth.module.css";
import { api, ApiError } from "../lib/api";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string>();
  const [complete, setComplete] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setError(undefined); setSubmitting(true);
    try { await api.requestPasswordReset(email); setComplete(true); }
    catch (cause) { setError(cause instanceof ApiError ? cause.message : "No se ha podido solicitar el restablecimiento."); }
    finally { setSubmitting(false); }
  }

  return <main className={styles.page}><section className={styles.box}><div className={styles.brand}><span>s</span>Starter</div><h1>Restablece tu contraseña</h1>{complete ? <p>Si existe una cuenta con ese correo, recibirás un enlace para restablecer la contraseña.</p> : <><p>Te enviaremos un enlace de un solo uso.</p><form className={styles.form} onSubmit={submit}><label>Correo electrónico<input name="email" type="email" autoComplete="email" placeholder="tu@empresa.com" required /></label>{error && <p className={styles.error} role="alert">{error}</p>}<button type="submit" disabled={submitting}>{submitting ? "Enviando…" : "Enviar enlace"}</button></form></>}<p className={styles.footer}><Link href="/login">Volver a iniciar sesión</Link></p></section></main>;
}
