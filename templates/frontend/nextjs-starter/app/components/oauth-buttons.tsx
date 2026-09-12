"use client";

import { useState } from "react";
import { api, ApiError, type OAuthProvider } from "../lib/api";
import styles from "../auth.module.css";

export function OAuthButtons() {
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<OAuthProvider>();
  async function start(provider: OAuthProvider) {
    setError(undefined); setPending(provider);
    try { await api.beginOAuth(provider); }
    catch (cause) { setPending(undefined); setError(cause instanceof ApiError ? cause.message : "No se ha podido iniciar sesión con este proveedor."); }
  }
  return <div className={styles.oauth} aria-label="Acceder con un proveedor externo">
    <p className={styles.divider}><span>o continúa con</span></p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.oauthActions}>
      <button type="button" className={styles.secondaryButton} disabled={Boolean(pending)} onClick={() => void start("google")}>{pending === "google" ? "Abriendo Google…" : "Google"}</button>
      <button type="button" className={styles.secondaryButton} disabled={Boolean(pending)} onClick={() => void start("github")}>{pending === "github" ? "Abriendo GitHub…" : "GitHub"}</button>
    </div>
  </div>;
}
