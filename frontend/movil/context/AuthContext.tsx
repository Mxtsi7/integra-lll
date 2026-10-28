import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  guardarTokens,
  haySesionValida,
  logout,
  revocarSesion,
  getUsuarioActual,
  type Usuario,
} from '@ojoalgasto/shared';

export type EstadoAuth = 'cargando' | 'anonimo' | 'autenticado';

export type Tokens = { access_token: string; refresh_token: string };

type AuthValue = {
  usuario: Usuario | null;
  estado: EstadoAuth;
  haySesion: boolean;
  iniciarSesion: (tokens: Tokens, usuario?: Usuario) => void;
  cerrarSesion: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({
  initialUsuario = null,
  initialEstado,
  children,
}: {
  initialUsuario?: Usuario | null;
  initialEstado?: EstadoAuth;
  children: React.ReactNode;
}) {
  const [usuario, setUsuario] = useState<Usuario | null>(initialUsuario);
  const [estado, setEstado] = useState<EstadoAuth>(
    initialEstado ?? (initialUsuario ? 'autenticado' : 'cargando')
  );

  // Bootstrap al arrancar la app: valida si hay sesión guardada en shared
  useEffect(() => {
    if (initialEstado || initialUsuario) return;

    let activo = true;

    async function verificarSesionInicial() {
      try {
        if (!haySesionValida()) {
          logout();
          if (activo) {
            setUsuario(null);
            setEstado('anonimo');
          }
          return;
        }

        const u = await getUsuarioActual();
        if (activo) {
          setUsuario(u);
          setEstado('autenticado');
        }
      } catch {
        // En caso de fallo de red se mantiene como anónimo de forma segura
        if (activo) {
          setUsuario(null);
          setEstado('anonimo');
        }
      }
    }

    void verificarSesionInicial();

    return () => {
      activo = false;
    };
  }, [initialEstado, initialUsuario]);

  const iniciarSesion = useCallback(
    (tokens: Tokens, u?: Usuario) => {
      guardarTokens(tokens);
      if (!haySesionValida()) {
        logout();
        setUsuario(null);
        setEstado('anonimo');
        throw new Error('Token inválido o expirado');
      }

      setUsuario(u ?? null);
      setEstado('autenticado');

      if (!u) {
        void getUsuarioActual()
          .then((usuarioCargado) => {
            setUsuario(usuarioCargado);
          })
          .catch(() => {
            // Se mantiene autenticado si falla getUsuarioActual por red
          });
      }
    },
    []
  );

  const cerrarSesion = useCallback(async () => {
    try {
      await revocarSesion();
    } catch {
      // Ignorar error si el backend no responde
    } finally {
      logout();
      setUsuario(null);
      setEstado('anonimo');
    }
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      usuario,
      estado,
      haySesion: estado === 'autenticado',
      iniciarSesion,
      cerrarSesion,
    }),
    [usuario, estado, iniciarSesion, cerrarSesion]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
