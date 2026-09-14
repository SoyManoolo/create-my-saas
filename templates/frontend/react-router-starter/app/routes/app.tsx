import { Link } from "react-router";
import { AppShell } from "../components/app-shell";
import { ProtectedRoute } from "../components/protected-route";
import { privatePageMetadata } from "../lib/seo";

export function meta() { return privatePageMetadata({ title: "Inicio | SaaS starter", description: "Tu espacio de trabajo autenticado.", path: "/app" }); }

export default function Dashboard() {
  return <ProtectedRoute><AppShell><main className="dashboard"><p className="eyebrow">ESPACIO DE TRABAJO</p><h1>Tu base de producto <span>✦</span></h1><p className="lead">La sesión, el perfil y las rutas protegidas ya están conectadas. Añade ahora el dominio específico de tu SaaS.</p><section className="feature-grid"><article><strong>Tu cuenta</strong><span>Gestiona tu perfil y el estado de verificación.</span><Link to="/account">Abrir cuenta →</Link></article><article><strong>Contenido principal</strong><span>Aquí aparecerán las entidades y flujos del producto.</span></article></section><section className="empty"><div>✦</div><h2>Haz que este espacio sea tuyo</h2><p>La navegación y esta vista son deliberadamente neutrales. Añade aquí los recursos que hacen único a tu servicio.</p></section></main></AppShell></ProtectedRoute>;
}
