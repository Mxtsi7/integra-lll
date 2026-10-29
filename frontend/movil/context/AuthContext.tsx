import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  haySesionValida,
  revocarSesion,
  getUsuarioActual,
  configurarManejador401,
  ErrorDeApi,
  type Usuario,
} from '@ojoalgasto/shared';
import {
  hidratarSesionSegura,
  guardarTokensSeguros,
  limpiarSesionSegura,
} from '../src/services/storageSeguro';

export type EstadoAuth = 'cargando' | 'anonimo' | 'autenticado';

export type EstadoPerfil = 'inactivo' | 'cargando' | 'cargado' | 'error';

export type Tokens = { access_token: string; refresh_token: string };

type AuthValue = {
  usuario: Usuario | null;
  estado: EstadoAuth;
  haySesion: boolean;
  estadoPerfil: EstadoPerfil;
  errorPerfil: string | null;
  iniciarSesion: (tokens: Tokens, usuario?: Usuario) => void;
  cerrarSesion: () => Promise<void>;
  recargarPerfil: () => Promise<void>;
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
  const [estadoPerfil, setEstadoPerfil] = useState<EstadoPerfil>(
    initialUsuario
      ? 'cargado'
      : initialEstado === 'anonimo'
      ? 'inactivo'
      : initialEstado === 'autenticado'
      ? 'cargando'
      : 'inactivo'
  );
  const [errorPerfil, setErrorPerfil] = useState<string | null>(null);

  // Contador de generación de sesión para invalidar respuestas tardías (race conditions)
  const sesionVigente = useRef(0);
  const ultimaPeticion = useRef(0);

  const cargarPerfil = useCallback(async (idSesion: number) => {
    const idPeticion = ++ultimaPeticion.current;
    const esVigente = () =>
      idSesion === sesionVigente.current && idPeticion === ultimaPeticion.current;

    setEstadoPerfil('cargando');
    setErrorPerfil(null);

    try {
      const u = await getUsuarioActual();
      if (!esVigente()) return;

      setUsuario(u);
      setEstadoPerfil('cargado');
      setErrorPerfil(null);
    } catch (err: unknown) {
      if (!esVigente()) return;

      if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
        // Token revocado o usuario inexistente: la sesión no sirve
        void limpiarSesionSegura();
        setUsuario(null);
        setEstado('anonimo');
        setEstadoPerfil('inactivo');
        setErrorPerfil(null);
        return;
      }

      // Error transitorio (red/servidor): el token sigue vigente, pero el perfil no se inventa
      setUsuario(null);
      setEstadoPerfil('error');
      setErrorPerfil(err instanceof Error ? err.message : 'Error al cargar perfil');
    }
  }, []);

  // Bootstrap al arrancar la app: hidrata tokens desde SecureStore y valida la sesión
  useEffect(() => {
    if (initialEstado || initialUsuario) return;

    const idSesion = ++sesionVigente.current;

    async function verificarSesionInicial() {
      // 1. Hidratación asíncrona desde SecureStore hacia caché síncrono en memoria
      await hidratarSesionSegura();

      if (idSesion !== sesionVigente.current) return;

      // 2. Verificación de vigencia y desfase de reloj del token recuperado
      if (!haySesionValida()) {
        await limpiarSesionSegura();
        if (idSesion === sesionVigente.current) {
          setUsuario(null);
          setEstado('anonimo');
          setEstadoPerfil('inactivo');
          setErrorPerfil(null);
        }
        return;
      }

      if (idSesion === sesionVigente.current) {
        setEstado('autenticado');
      }
      await cargarPerfil(idSesion);
    }

    void verificarSesionInicial();
  }, [initialEstado, initialUsuario, cargarPerfil]);

  // Interceptor 401 de cliente API: si un endpoint protegido devuelve 401, limpia la sesión
  useEffect(() => {
    configurarManejador401(() => {
      sesionVigente.current++;
      ultimaPeticion.current++;
      void limpiarSesionSegura();
      setUsuario(null);
      setEstado('anonimo');
      setEstadoPerfil('inactivo');
      setErrorPerfil(null);
    });
    return () => {
      configurarManejador401(() => {});
    };
  }, []);

  const iniciarSesion = useCallback(
    (tokens: Tokens, u?: Usuario) => {
      void guardarTokensSeguros(tokens);
      if (!haySesionValida()) {
        void limpiarSesionSegura();
        setUsuario(null);
        setEstado('anonimo');
        setEstadoPerfil('inactivo');
        setErrorPerfil(null);
        throw new Error('Token inválido o expirado');
      }

      const idSesion = ++sesionVigente.current;
      setEstado('autenticado');

      if (u) {
        setUsuario(u);
        setEstadoPerfil('cargado');
        setErrorPerfil(null);
      } else {
        setUsuario(null);
        void cargarPerfil(idSesion);
      }
    },
    [cargarPerfil]
  );

  const cerrarSesion = useCallback(async () => {
    // Invalida inmediatamente cualquier petición asíncrona de perfil en vuelo
    sesionVigente.current++;
    ultimaPeticion.current++;

    try {
      await revocarSesion();
    } catch {
      // Ignorar error si el backend no responde
    } finally {
      await limpiarSesionSegura();
      setUsuario(null);
      setEstado('anonimo');
      setEstadoPerfil('inactivo');
      setErrorPerfil(null);
    }
  }, []);

  const recargarPerfil = useCallback(async () => {
    if (!haySesionValida()) {
      await limpiarSesionSegura();
      setUsuario(null);
      setEstado('anonimo');
      setEstadoPerfil('inactivo');
      setErrorPerfil(null);
      return;
    }
    await cargarPerfil(sesionVigente.current);
  }, [cargarPerfil]);

  const value = useMemo<AuthValue>(
    () => ({
      usuario,
      estado,
      haySesion: estado === 'autenticado',
      estadoPerfil,
      errorPerfil,
      iniciarSesion,
      cerrarSesion,
      recargarPerfil,
    }),
    [usuario, estado, estadoPerfil, errorPerfil, iniciarSesion, cerrarSesion, recargarPerfil]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
