import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { Usuario } from '@ojoalgasto/shared';

type AuthValue = {
  usuario: Usuario | null;
  haySesion: boolean;
  iniciarSesion: (usuario: Usuario) => void;
  cerrarSesion: () => void;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  initialUsuario = null,
  children,
}: {
  initialUsuario?: Usuario | null;
  children: React.ReactNode;
}) {
  const [usuario, setUsuario] = useState<Usuario | null>(initialUsuario);

  const iniciarSesion = useCallback((u: Usuario) => setUsuario(u), []);
  const cerrarSesion = useCallback(() => setUsuario(null), []);

  const value = useMemo(
    () => ({ usuario, haySesion: usuario !== null, iniciarSesion, cerrarSesion }),
    [usuario, iniciarSesion, cerrarSesion]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
