"use client";

import { useState } from "react";
import { AppShell } from "../components/app-shell";
import { ProtectedPage } from "../components/protected-page";
import { useAuth } from "../components/auth-provider";
import styles from "../product.module.css";

export default function AccountPage() {
  const { user, resendVerification } = useAuth();
  const [notice, setNotice] = useState<string>();

  async function resend() {
    try { await resendVerification(); setNotice("Hemos enviado un nuevo enlace de verificación."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "No se ha podido reenviar el enlace."); }
  }

  return <ProtectedPage><AppShell><section className={styles.content}><p className={styles.eyebrow}>CUENTA</p><h1>Perfil</h1><p className={styles.lead}>Identidad y estado de verificación de la sesión actual.</p><div className={styles.grid}><article className={styles.card}><div className={styles.cardIcon}>{user?.name.slice(0, 1).toUpperCase()}</div><p>Usuario actual</p><strong>{user?.name}</strong><span>{user?.email}</span><span>{user?.emailVerified ? "Correo verificado" : "Correo sin verificar"}</span>{!user?.emailVerified && <button type="button" onClick={() => void resend()}>Reenviar verificación →</button>}{notice && <span role="status">{notice}</span>}</article><article className={styles.card}><div className={styles.cardIcon}>⌘</div><p>Tu SaaS</p><strong>Listo para extender</strong><span>Añade aquí los módulos de facturación, organizaciones o el dominio de tu producto.</span></article></div></section></AppShell></ProtectedPage>;
}
