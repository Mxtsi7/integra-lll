import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  haySesionValida,
  getUsuarioActual,
  configurarManejador401,
  ErrorDeApi,
  sesionDelToken,
  type Usuario,
} from '@ojoalgasto/shared';
import {
  hidratarSesionSegura,
  guardarTokensSeguros,
  limpiarSesionSegura,
  obtenerTokensSeguros,
  validarFormatoToken,
  hayLimpiezaPendienteSegura,
} from '../src/services/storageSeguro';
import { revocarTokensRemotos } from '../src/services/clienteHttp';

export type EstadoAuth = 'cargando' | 'anonimo' | 'autenticado';

export type EstadoPerfil = 'inactivo' | 'cargando' | 'cargado' | 'error';

export type Tokens = { access_token: string; refresh_token: string };

type AuthValue = {
  usuario: Usuario | null;
  estado: EstadoAuth;
  haySesion: boolean;
  estadoPerfil: EstadoPerfil;
  errorPerfil: string | null;
  /**
   * P1 (VI-16): mensaje cuando el borrado durable de la sesión no pudo
   * confirmarse. Mientras esté presente, el login queda bloqueado hasta que
   * `reintentarCierre()` confirme la limpieza.
   */
  errorCierre: string | null;
  iniciarSesion: (tokens: Tokens, usuario?: Usuario) => Promise<void>;
  cerrarSesion: () => Promise<void>;
  reintentarCierre: () => Promise<boolean>;
  recargarPerfil: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

const MENSAJE_CIERRE_PENDIENTE =
  'No se pudo confirmar el borrado seguro de la sesión. Las pantallas privadas seguirán cerradas hasta reintentar.';

const MENSAJE_CIERRE_PENDIENTE_ARRANQUE =
  'El cierre de sesión anterior no se pudo confirmar. Reintenta la limpieza antes de volver a entrar.';

/**
 * true si ambos tokens pertenecen a la misma sesión (uno es el refresh del
 * otro). Con tokens opacos no se puede afirmar: se devuelve false para no
 * reutilizar credenciales de una sesión distinta.
 */
function esLaMismaSesion(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const sesionA = sesionDelToken(a);
  return sesionA !== null && sesionA === sesionDelToken(b);
}

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
  const [errorCierre, setErrorCierre] = useState<string | null>(null);

  // Contador de generación de sesión para invalidar respuestas tardías (race conditions)
  const sesionVigente = useRef(0);
  const ultimaPeticion = useRef(0);
  // Evita que un login nuevo se acepte mientras el cierre anterior no se
  // confirmó en el keystore (se consulta de forma síncrona).
  const cierrePendiente = useRef(false);

  const marcarCierrePendiente = useCallback((mensaje = MENSAJE_CIERRE_PENDIENTE) => {
    cierrePendiente.current = true;
    setErrorCierre(mensaje);
  }, []);

  const limpiarEstadoVisible = useCallback(() => {
    setUsuario(null);
    setEstado('anonimo');
    setEstadoPerfil('inactivo');
    setErrorPerfil(null);
  }, []);

  /** Deja la UI en anónimo y confirma la limpieza durable. */
  const cerrarLocalmente = useCallback(async () => {
    sesionVigente.current++;
    ultimaPeticion.current++;
    limpiarEstadoVisible();

    try {
      await limpiarSesionSegura();
      cierrePendiente.current = false;
      setErrorCierre(null);
    } catch {
      // La navegación pública ya ocurrió; el fallo durable se expone para
      // que el usuario pueda reintentar desde el login.
      marcarCierrePendiente();
    }
  }, [limpiarEstadoVisible, marcarCierrePendiente]);

  const cargarPerfil = useCallback(
    async (idSesion: number) => {
      const idPeticion = ++ultimaPeticion.current;
      const esVigente = () =>
        idSesion === sesionVigente.current && idPeticion === ultimaPeticion.current;

      setEstadoPerfil('cargando');
      setErrorPerfil(null);

      // El perfil puede rechazarse con el access anterior mientras una
      // rotación de la misma sesión ya guardó otro. En ese caso se vuelve a
      // consultar con el vigente, sin cerrar la sesión.
      for (;;) {
        const tokenDeLaConsulta = obtenerTokensSeguros().access_token;

        try {
          const u = await getUsuarioActual();
          if (!esVigente()) return;

          setUsuario(u);
          setEstadoPerfil('cargado');
          setErrorPerfil(null);
          return;
        } catch (err: unknown) {
          if (!esVigente()) return;

          if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
            const tokenActual = obtenerTokensSeguros().access_token;

            if (tokenActual !== tokenDeLaConsulta) {
              if (tokenActual !== null && esLaMismaSesion(tokenActual, tokenDeLaConsulta)) {
                // Rotación válida de la misma sesión: el 401 pertenece al
                // access anterior, no a la sesión vigente.
                continue;
              }
              // Otra sesión (A→B): su carga la hará quien inició B. Esta
              // respuesta tardía no debe borrar ni pisar credenciales ajenas.
              return;
            }

            // Un 401 de la petición original no demuestra que el refresh
            // haya sido rechazado. Red/503/timeout conserva los tokens y
            // deja el perfil en estado recuperable (recargarPerfil).
            const motivo = err.sesion?.motivo;
            if (
              err.status === 401 &&
              (motivo === 'renovacion_temporal' || motivo === 'token_obsoleto')
            ) {
              setUsuario(null);
              setEstadoPerfil('error');
              setErrorPerfil(err.message);
              return;
            }

            // 404 (usuario inexistente) o rechazo definitivo del refresh
            // vigente: la sesión ya no sirve.
            await cerrarLocalmente();
            return;
          }

          // Error transitorio (red/servidor): el token sigue vigente, pero el perfil no se inventa
          setUsuario(null);
          setEstadoPerfil('error');
          setErrorPerfil(err instanceof Error ? err.message : 'Error al cargar perfil');
          return;
        }
      }
    },
    [cerrarLocalmente]
  );

  // Bootstrap al arrancar la app: hidrata tokens desde SecureStore y valida la sesión
  useEffect(() => {
    if (initialEstado || initialUsuario) return;

    const idSesion = ++sesionVigente.current;

    async function verificarSesionInicial() {
      // 1. Hidratación asíncrona desde SecureStore hacia caché síncrono en memoria
      await hidratarSesionSegura();

      if (idSesion !== sesionVigente.current) return;

      // 2. Si el cierre anterior no pudo confirmarse, no se acepta la sesión
      // persistida: se mantiene el login y el aviso recuperable.
      if (hayLimpiezaPendienteSegura()) {
        cierrePendiente.current = true;
        limpiarEstadoVisible();
        setErrorCierre(MENSAJE_CIERRE_PENDIENTE_ARRANQUE);
        return;
      }

      // 3. Verificación de vigencia y desfase de reloj del token recuperado
      if (!haySesionValida()) {
        try {
          await limpiarSesionSegura();
        } catch {
          // El arranque no debe romper por un keystore que rechaza borrados:
          // queda como anónimo y el fallo es visible al reintentar el cierre.
        }
        if (idSesion === sesionVigente.current) {
          limpiarEstadoVisible();
        }
        return;
      }

      if (idSesion === sesionVigente.current) {
        setEstado('autenticado');
      }
      await cargarPerfil(idSesion);
    }

    void verificarSesionInicial();
  }, [initialEstado, initialUsuario, cargarPerfil, limpiarEstadoVisible]);

  // Interceptor 401 de cliente API: si un endpoint protegido devuelve 401, limpia la sesión
  useEffect(() => {
    configurarManejador401(() => {
      void cerrarLocalmente();
    });
    return () => {
      configurarManejador401(() => {});
    };
  }, [cerrarLocalmente]);

  const iniciarSesion = useCallback(
    async (tokens: Tokens, u?: Usuario) => {
      // Un cierre no confirmado debe resolverse antes de aceptar otra sesión.
      if (cierrePendiente.current) {
        throw new Error(
          'Hay un cierre de sesión pendiente; reintenta la limpieza antes de volver a entrar.'
        );
      }

      // 0. Capturar la identidad de esta operación antes de cualquier paso asíncrono
      const idSesion = ++sesionVigente.current;
      ultimaPeticion.current++;
      const esVigente = () => idSesion === sesionVigente.current;

      // 1. Prevalidación de estructura y formato del token recibido
      if (!tokens.access_token || !validarFormatoToken(tokens.access_token)) {
        if (esVigente()) {
          limpiarEstadoVisible();
        }
        throw new Error('Token inválido o expirado');
      }

      // 2. Persistencia segura atómica en hardware esperando su confirmación
      try {
        await guardarTokensSeguros(tokens);
      } catch (err) {
        // Rollback del contexto SOLO si esta operación sigue siendo la vigente
        if (esVigente()) {
          limpiarEstadoVisible();
        }
        throw err;
      }

      // Si durante la persistencia se inició otra sesión o logout, abortar
      if (!esVigente()) {
        return;
      }

      // 3. Validación de vigencia del token guardado (con desfase de reloj)
      if (!haySesionValida()) {
        try {
          await limpiarSesionSegura();
        } catch {
          // El token ya no sirve; el fallo de borrado se reintenta al cerrar.
        }
        if (esVigente()) {
          limpiarEstadoVisible();
        }
        throw new Error('Token inválido o expirado');
      }

      if (!esVigente()) {
        return;
      }

      // 4. Transicionar a autenticado SOLO tras persistencia y validación exitosas
      cierrePendiente.current = false;
      setErrorCierre(null);
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
    [cargarPerfil, limpiarEstadoVisible]
  );

  const cerrarSesion = useCallback(async () => {
    // 1. Invalida inmediatamente cualquier petición asíncrona de perfil o sesión en vuelo
    sesionVigente.current++;
    ultimaPeticion.current++;

    // 2. Capturar credenciales activas y vigencia del access token antes de limpiar memoria
    const credenciales = obtenerTokensSeguros();
    const accesoVigente = haySesionValida();

    // 3. Cierre inmediato en memoria para navegación pública instantánea
    limpiarEstadoVisible();

    // 4. Revocación remota aislada en segundo plano con las credenciales capturadas y vigencia
    if (credenciales.refresh_token) {
      void revocarTokensRemotos(credenciales, accesoVigente);
    }

    // 5. Limpieza persistente en hardware seguro: se ejecuta inmediatamente (no después de la red)
    try {
      await limpiarSesionSegura();
      cierrePendiente.current = false;
      setErrorCierre(null);
    } catch {
      // P1: el cierre no se declara exitoso si el keystore no confirmó el
      // borrado. La UI ya está en anónimo y el login queda bloqueado hasta
      // que `reintentarCierre()` lo confirme.
      marcarCierrePendiente();
    }
  }, [limpiarEstadoVisible, marcarCierrePendiente]);

  const reintentarCierre = useCallback(async () => {
    try {
      await limpiarSesionSegura();
      cierrePendiente.current = false;
      setErrorCierre(null);
      return true;
    } catch {
      marcarCierrePendiente();
      return false;
    }
  }, [marcarCierrePendiente]);

  const recargarPerfil = useCallback(async () => {
    if (!haySesionValida()) {
      await cerrarLocalmente();
      return;
    }
    await cargarPerfil(sesionVigente.current);
  }, [cargarPerfil, cerrarLocalmente]);

  const value = useMemo<AuthValue>(
    () => ({
      usuario,
      estado,
      haySesion: estado === 'autenticado',
      estadoPerfil,
      errorPerfil,
      errorCierre,
      iniciarSesion,
      cerrarSesion,
      reintentarCierre,
      recargarPerfil,
    }),
    [
      usuario,
      estado,
      estadoPerfil,
      errorPerfil,
      errorCierre,
      iniciarSesion,
      cerrarSesion,
      reintentarCierre,
      recargarPerfil,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
