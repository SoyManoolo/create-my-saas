import { Link, NavLink, useNavigate } from "react-router";
import { useAuth } from "../lib/auth-context";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();

  async function logout() {
    await signOut();
    navigate("/login", { replace: true });
  }

  return <div className="app-shell"><aside><Link className="brand" to="/app"><span>✦</span> SaaS starter</Link><nav><NavLink to="/app">Inicio</NavLink><NavLink to="/account">Cuenta</NavLink></nav><div className="profile"><strong>{user?.name}</strong><small>{user?.email}</small><button type="button" onClick={logout}>Cerrar sesión</button></div></aside><div className="workspace">{children}</div></div>;
}
