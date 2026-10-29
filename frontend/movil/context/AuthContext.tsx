import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  guardarTokens,
  haySesionValida,
  logout,
  renovarSesion,
  obtenerRefreshToken,
  revocarSesion,
  getUsuarioActual,
  configurarManejador401,
  ErrorDeApi,
  type Usuario,
} from '@ojoalgasto/shared';
import { hidratarSesion } from '../src/storage/sesionSegura';

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
        logout();
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

  // Bootstrap al arrancar la app: valida si hay sesión guardada en shared
  useEffect(() => {
    if (initialEstado || initialUsuario) return;

    const idSesion = ++sesionVigente.current;

    async function verificarSesionInicial() {
      // VI-16: el espejo en memoria arranca vacío; primero se leen los tokens
      // cifrados. Sin esta espera se decidiría "sin sesión" antes de leerlos.
      await hidratarSesion();

      let valida = haySesionValida();
      const teniaRefresh = obtenerRefreshToken() !== null;

      // El access dura 30 min; si venció pero hay refresh, se renueva antes
      // de mandar al login. Si el backend está caído, renovarSesion() devuelve
      // false y CONSERVA los tokens: no se muestran datos previos, pero la
      // sesión se puede recuperar cuando el backend vuelva (o al reabrir).
      if (!valida && teniaRefresh) {
        valida = await renovarSesion();
      }

      if (idSesion !== sesionVigente.current) return;

      if (!valida) {
        // Un access vencido sin refresh no tiene recuperación posible.
        if (!teniaRefresh) logout();
        setUsuario(null);
        setEstado('anonimo');
        setEstadoPerfil('inactivo');
        setErrorPerfil(null);
        return;
      }

      setEstado('autenticado');
      await cargarPerfil(idSesion);
    }

    void verificarSesionInicial();
  }, [initialEstado, initialUsuario, cargarPerfil]);

  // Interceptor 401 de cliente API: si un endpoint protegido devuelve 401, limpia la sesión
  useEffect(() => {
    configurarManejador401(() => {
      sesionVigente.current++;
      ultimaPeticion.current++;
      logout();
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
      guardarTokens(tokens);
      if (!haySesionValida()) {
        logout();
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
      logout();
      setUsuario(null);
      setEstado('anonimo');
      setEstadoPerfil('inactivo');
      setErrorPerfil(null);
    }
  }, []);

  const recargarPerfil = useCallback(async () => {
    if (!haySesionValida()) {
      logout();
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
