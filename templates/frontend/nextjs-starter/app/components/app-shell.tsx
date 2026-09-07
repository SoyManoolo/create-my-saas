"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import styles from "./app-shell.module.css";

const items = [
  { href: "/", label: "Inicio", icon: "⌂" },
  { href: "/settings", label: "Configuración", icon: "⚙" },
  { href: "/account", label: "Cuenta", icon: "◉" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const savedTheme = window.localStorage.getItem("nexa-theme");
    const useDark = savedTheme === "dark" || (!savedTheme && window.matchMedia("(prefers-color-scheme: dark)").matches);
    setDark(useDark);
    document.documentElement.dataset.theme = useDark ? "dark" : "light";
  }, []);
  function toggleTheme() {
    const nextTheme = !dark;
    setDark(nextTheme);
    document.documentElement.dataset.theme = nextTheme ? "dark" : "light";
    window.localStorage.setItem("nexa-theme", nextTheme ? "dark" : "light");
  }
  return <div className={styles.app}>
    <aside className={styles.sidebar}>
      <Link className={styles.brand} href="/"><span>n</span>Nexa</Link>
      <div className={styles.workspace}><i>W</i><div><strong>Mi espacio</strong><small>Plan Free</small></div><b>⌄</b></div>
      <nav aria-label="Navegación principal">{items.map((item) => <Link key={item.href} className={pathname === item.href ? styles.active : ""} href={item.href}><i>{item.icon}</i>{item.label}</Link>)}</nav>
      <div className={styles.sidebarBottom}><div className={styles.starter}><span>✦</span><strong>Tu producto empieza aquí</strong><p>Añade los recursos y herramientas propias de tu SaaS en la navegación.</p></div><Link className={styles.user} href="/account"><i>ER</i><div><strong>Erik Ramos</strong><small>Administrador</small></div><b>···</b></Link></div>
    </aside>
    <main className={styles.main}><header className={styles.header}><div><span className={styles.statusDot}/>Todos los sistemas operativos</div><div className={styles.headerActions}><button onClick={toggleTheme} aria-label={dark ? "Activar modo claro" : "Activar modo oscuro"} title={dark ? "Modo claro" : "Modo oscuro"}>{dark ? "☀" : "☾"}</button><button aria-label="Notificaciones">♧</button><Link href="/account">ER</Link></div></header>{children}</main>
  </div>;
}
