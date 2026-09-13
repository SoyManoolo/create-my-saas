import { useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function logout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return <div className="app-shell"><header className="mobile-header"><button type="button" aria-expanded={menuOpen} aria-controls="main-navigation" onClick={() => setMenuOpen((open) => !open)}>Menú</button><Link className="brand" to="/app"><span>✦</span> SaaS starter</Link></header><aside className={menuOpen ? "open" : ""}><Link className="brand" to="/app"><span>✦</span> SaaS starter</Link><nav id="main-navigation"><NavLink onClick={() => setMenuOpen(false)} to="/app">Inicio</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/billing">Facturación</NavLink><NavLink onClick={() => setMenuOpen(false)} to="/account">Cuenta</NavLink></nav><div className="profile"><strong>{user?.name}</strong><small>{user?.email}</small><button type="button" onClick={logout}>Cerrar sesión</button></div></aside><div className="workspace">{children}</div></div>;
}
