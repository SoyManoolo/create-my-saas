"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type User } from "../lib/api";

type AuthStatus = "loading" | "authenticated" | "anonymous";
type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerification: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const accessToken = useRef<string | null>(null);

  const restoreSession = useCallback(async () => {
    try {
      const session = await api.refresh();
      accessToken.current = session.accessToken;
      setUser(session.user);
      setStatus("authenticated");
    } catch {
      accessToken.current = null;
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(restoreSession); }, [restoreSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await api.login({ email, password });
    accessToken.current = session.accessToken;
    setUser(session.user);
    setStatus("authenticated");
  }, []);

  const signOut = useCallback(async () => {
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

  return <AuthContext.Provider value={{ status, user, signIn, signOut, resendVerification }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de AuthProvider.");
  return context;
}
