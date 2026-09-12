"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../auth.module.css";
import { api, ApiError } from "../lib/api";

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get("token");
  const [state, setState] = useState<"loading" | "complete" | "error">("loading");
  const [message, setMessage] = useState("Verificando tu correo…");

  useEffect(() => {
    if (!token) return;
    void api.verifyEmail(token).then(() => { setMessage("Tu correo se ha verificado correctamente."); setState("complete"); }).catch((cause) => {
      setMessage(cause instanceof ApiError ? cause.message : "No se ha podido verificar el correo."); setState("error");
    });
  }, [token]);

  const invalidLink = !token;
  return <main className={styles.page}><section className={styles.box}><div className={styles.brand}><span>s</span>Starter</div><h1>{state === "complete" ? "Correo verificado" : "Verificación de correo"}</h1><p role="status">{invalidLink ? "El enlace de verificación no es válido." : message}</p>{(state !== "loading" || invalidLink) && <p className={styles.footer}><Link href="/login">Iniciar sesión</Link></p>}</section></main>;
}

export default function VerifyEmailPage() {
  return <Suspense fallback={<main className="page-status">Cargando…</main>}><VerifyEmail /></Suspense>;
}
