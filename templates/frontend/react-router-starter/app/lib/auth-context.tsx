import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type User } from "./api.client";

type AuthStatus = "loading" | "authenticated" | "anonymous";
type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerification: () => Promise<void>;
  completeOAuth: () => Promise<void>;
  getAccessToken: () => string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const accessToken = useRef<string | null>(null);
  const sessionAttempt = useRef(0);

  const restoreSession = useCallback(async () => {
    const attempt = ++sessionAttempt.current;
    try {
      const session = await api.refresh();
      if (attempt !== sessionAttempt.current) return;
      accessToken.current = session.accessToken;
      setUser(session.user);
      setStatus("authenticated");
    } catch {
      if (attempt !== sessionAttempt.current) return;
      accessToken.current = null;
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => { void restoreSession(); }, [restoreSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const attempt = ++sessionAttempt.current;
    const session = await api.login({ email, password });
    if (attempt !== sessionAttempt.current) return;
    accessToken.current = session.accessToken;
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
    ++sessionAttempt.current;
    try { await api.logout(); } finally {
      accessToken.current = null;
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const resendVerification = useCallback(async () => {
    if (!accessToken.current) throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
    await api.resendEmailVerification(accessToken.current);
  }, []);

  const completeOAuth = useCallback(async () => { await restoreSession(); }, [restoreSession]);
  const getAccessToken = useCallback(() => {
    if (!accessToken.current) throw new Error("La sesión ha caducado. Inicia sesión de nuevo.");
    return accessToken.current;
  }, []);

  return <AuthContext.Provider value={{ status, user, signIn, signOut, resendVerification, completeOAuth, getAccessToken }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider.");
  return context;
}
