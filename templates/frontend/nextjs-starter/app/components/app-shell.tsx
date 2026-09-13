"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import styles from "./app-shell.module.css";
import { useAuth } from "./auth-provider";

const items = [
  { href: "/", label: "Inicio", icon: "⌂" },
  { href: "/settings", label: "Configuración", icon: "⚙" },
  { href: "/billing", label: "Facturación", icon: "€" },
  { href: "/account", label: "Cuenta", icon: "◉" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  async function logout() { await signOut(); }
  const initials = user?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() ?? "";
  return <div className={styles.app}>
    <aside className={`${styles.sidebar} ${menuOpen ? styles.sidebarOpen : ""}`}>
      <Link className={styles.brand} href="/"><span>s</span>Starter</Link>
      <div className={styles.workspace}><i>{initials}</i><div><strong>Tu espacio</strong><small>Personaliza tu producto</small></div></div>
      <nav id="main-navigation" aria-label="Navegación principal">{items.map((item) => <Link key={item.href} onClick={() => setMenuOpen(false)} className={pathname === item.href ? styles.active : ""} href={item.href}><i>{item.icon}</i>{item.label}</Link>)}</nav>
      <div className={styles.sidebarBottom}><div className={styles.starter}><span>✦</span><strong>Tu producto empieza aquí</strong><p>Añade los recursos y herramientas propias de tu SaaS en la navegación.</p></div><div className={styles.user}><i>{initials}</i><div><strong>{user?.name}</strong><small>{user?.email}</small></div><button type="button" onClick={() => void logout()} aria-label="Cerrar sesión">Salir</button></div></div>
    </aside>
    <main className={styles.main}><header className={styles.header}><button className={styles.menuButton} type="button" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-controls="main-navigation">Menú</button><div><span className={styles.statusDot}/>Sesión activa</div><div className={styles.headerActions}><Link href="/account" aria-label="Abrir cuenta">{initials}</Link></div></header>{children}</main>
  </div>;
}
