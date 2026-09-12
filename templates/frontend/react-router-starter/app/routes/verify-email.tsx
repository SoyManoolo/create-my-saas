import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { ApiError, api } from "../lib/api.client";

export function meta() { return [{ title: "Verificar email · SaaS starter" }]; }

export default function VerifyEmail() {
  const [search] = useSearchParams();
  const token = search.get("token");
  const [message, setMessage] = useState("Verificando tu dirección de correo…");

  useEffect(() => {
    if (!token) { setMessage("El enlace no incluye un token de verificación válido."); return; }
    void api.verifyEmail(token).then(() => setMessage("Tu email ha sido verificado. Ya puedes iniciar sesión.")).catch((cause) => setMessage(cause instanceof ApiError ? cause.message : "No se ha podido verificar el email."));
  }, [token]);

  return <main className="auth-page"><section className="auth-card"><Link className="brand" to="/"><span>✦</span> SaaS starter</Link><h1>Verificación de email</h1><p className="success">{message}</p><p className="form-footer"><Link to="/login">Ir a entrar</Link></p></section></main>;
}
