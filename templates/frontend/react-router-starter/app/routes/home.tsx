import { Link } from "react-router";
import { publicPageMetadata } from "../lib/seo";

export function meta() {
  return publicPageMetadata({
    title: "SaaS starter",
    description: "Base reutilizable para lanzar tu próximo SaaS con autenticación y rutas protegidas.",
    path: "/",
  });
}

export default function Home() {
  return <main className="landing"><header><p className="brand"><span>✦</span> SaaS starter</p><nav><Link to="/login">Entrar</Link><Link className="button" to="/register">Crear cuenta</Link></nav></header><section className="hero"><p className="eyebrow">REACT ROUTER · FRAMEWORK MODE</p><h1>Construye el producto, no otra base de autenticación.</h1><p>Sesión de navegador, rutas protegidas y recuperación de cuenta ya están resueltas. Aquí empieza el dominio de tu SaaS.</p><div><Link className="button" to="/register">Empezar ahora</Link><Link className="text-link" to="/login">Ya tengo una cuenta →</Link></div></section><section className="feature-grid"><article><strong>Sesión segura</strong><span>Refresh cookies HttpOnly y access token sólo en memoria.</span></article><article><strong>Sin acoplamiento</strong><span>El proxy mismo-origen conecta FastAPI o Nest sin exponer tokens.</span></article><article><strong>Rutas listas</strong><span>Registro, acceso, recuperación, verificación y área protegida.</span></article></section></main>;
}
