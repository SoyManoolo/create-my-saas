"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./app-shell.module.css";

const items = [
  { href: "/", label: "Inicio", icon: "⌂" },
  { href: "/settings", label: "Configuración", icon: "⚙" },
  { href: "/account", label: "Cuenta", icon: "◉" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/"><span>n</span>Nexa</Link>
      <div className={styles.workspace}><i>W</i><div><strong>Mi espacio</strong><small>Plan Free</small></div><b>⌄</b></div>
      <nav aria-label="Navegación principal">{items.map((item) => <Link key={item.href} className={pathname === item.href ? styles.active : ""} href={item.href}><i>{item.icon}</i>{item.label}</Link>)}</nav>
      <div className={styles.sidebarBottom}><div className={styles.starter}><span>✦</span><strong>Tu producto empieza aquí</strong><p>Añade los recursos y herramientas propias de tu SaaS en la navegación.</p></div><Link className={styles.user} href="/account"><i>ER</i><div><strong>Erik Ramos</strong><small>Administrador</small></div><b>···</b></Link></div>
    </aside>
    <main className={styles.main}><header className={styles.header}><div><span className={styles.statusDot}/>Todos los sistemas operativos</div><div className={styles.headerActions}><button aria-label="Notificaciones">♧</button><Link href="/account">ER</Link></div></header>{children}</main>
  </div>;
}
