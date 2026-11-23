import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  cambiosDePreferencias,
  ErrorDeApi,
  preferenciasEditables,
} from '@ojoalgasto/shared';
import { useAuth } from '../../../../context/AuthContext';
import {
  canalPushHabilitadoEnDispositivo,
  crearControlPermisosNotificaciones,
} from '../../../services/permisosNotificaciones';
import {
  repositorioPreferenciasPorDefecto,
} from './data/preferenciasRepository';
import type {
  ClaveInterruptor,
  EstadoPermisoDispositivo,
  IPermisosDispositivoGateway,
  IPreferenciasRepository,
  PreferenciasAlertas,
  PreferenciasEditables,
} from './domain/preferencias.types';

const MENSAJE_SIN_RED =
  'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.';
const MENSAJE_ERROR_CARGA = 'No pudimos cargar tus preferencias. Intenta de nuevo.';

function formatearErrorGuardado(err: unknown): string {
  if (err instanceof TypeError) return MENSAJE_SIN_RED;
  if (err instanceof ErrorDeApi && err.status === 400 && err.message) {
    return `No se guardó: ${err.message}`;
  }
  return 'No pudimos guardar tus cambios. Siguen aquí: intenta de nuevo.';
}

export interface UsePreferenciasNotificacionesOpciones {
  repository?: IPreferenciasRepository;
  permisosGateway?: IPermisosDispositivoGateway;
  onExitoGuardar?: () => void;
  usuarioId?: string;
}

export function usePreferenciasNotificaciones({
  repository = repositorioPreferenciasPorDefecto,
  permisosGateway = crearControlPermisosNotificaciones(),
  onExitoGuardar,
  usuarioId: usuarioIdProp,
}: UsePreferenciasNotificacionesOpciones = {}) {
  let usuarioAuthId: string | undefined;
  try {
    usuarioAuthId = useAuth().usuario?.id;
  } catch {
    // Entorno de prueba aislado sin AuthProvider
  }
  const idVigente = usuarioIdProp ?? usuarioAuthId;
  const idUsuarioRef = useRef(idVigente);

  const [estadoCarga, setEstadoCarga] = useState<'cargando' | 'error' | 'listo'>('cargando');
  const [errorCargaMensaje, setErrorCargaMensaje] = useState<string>(MENSAJE_ERROR_CARGA);
  const [guardadas, setGuardadas] = useState<PreferenciasAlertas | null>(null);
  const [editadas, setEditadas] = useState<PreferenciasEditables | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  const [alertaPushDispositivo, setAlertaPushDispositivo] = useState<string | null>(null);

  // Permiso del dispositivo
  const [permisoDispositivo, setPermisoDispositivo] = useState<EstadoPermisoDispositivo>('no_determinado');

  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const actualizarPermisoDispositivo = useCallback(async () => {
    const estado = await permisosGateway.obtenerEstado();
    if (montado.current) {
      setPermisoDispositivo(estado);
      if (estado === 'denegado') {
        setAlertaPushDispositivo(
          'Permiso denegado en este dispositivo. Las notificaciones push están bloqueadas en los ajustes del sistema.'
        );
      } else {
        setAlertaPushDispositivo(null);
      }
    }
  }, [permisosGateway]);

  useEffect(() => {
    void actualizarPermisoDispositivo();
    const sub = AppState.addEventListener('change', (estadoApp) => {
      if (estadoApp === 'active') {
        void actualizarPermisoDispositivo();
      }
    });
    return () => sub.remove();
  }, [actualizarPermisoDispositivo]);

  const cargar = useCallback(async () => {
    setEstadoCarga('cargando');
    setErrorGuardado(null);
    try {
      const data = await repository.obtener();
      if (!montado.current) return;
      setGuardadas(data);
      setEditadas(preferenciasEditables(data));
      setEstadoCarga('listo');
    } catch (err: unknown) {
      if (!montado.current) return;
      setErrorCargaMensaje(err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_CARGA);
      setEstadoCarga('error');
    }
  }, [repository]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Si cambia la cuenta o sesión, descartar borrador y recargar
  useEffect(() => {
    if (idUsuarioRef.current !== idVigente) {
      idUsuarioRef.current = idVigente;
      void cargar();
    }
  }, [idVigente, cargar]);

  const cambios = guardadas && editadas ? cambiosDePreferencias(guardadas, editadas) : {};
  const hayCambios = Object.keys(cambios).length > 0;

  const cambiar = async (clave: ClaveInterruptor, valor: boolean) => {
    setErrorGuardado(null);

    if (clave === 'por_push') {
      if (valor === true) {
        if (permisoDispositivo === 'no_disponible') {
          setAlertaPushDispositivo(
            'Las notificaciones push no están disponibles en este dispositivo o compilación.'
          );
        } else if (permisoDispositivo === 'denegado') {
          setAlertaPushDispositivo(
            'Permiso denegado en el dispositivo. No se pueden recibir notificaciones push aquí hasta activarlas en Ajustes.'
          );
        } else if (permisoDispositivo === 'no_determinado') {
          const resultado = await permisosGateway.solicitarPermiso();
          setPermisoDispositivo(resultado);
          if (resultado === 'denegado') {
            setAlertaPushDispositivo(
              'Permiso denegado en el dispositivo. Las notificaciones push quedan inhabilitadas en este teléfono.'
            );
          } else if (resultado === 'no_disponible') {
            setAlertaPushDispositivo(
              'Las notificaciones push no están disponibles en este dispositivo o compilación.'
            );
          }
        }
      } else {
        setAlertaPushDispositivo(null);
      }
    }

    setEditadas((prev) => (prev ? { ...prev, [clave]: valor } : prev));
  };

  const descartar = () => {
    if (guardadas) {
      setEditadas(preferenciasEditables(guardadas));
    }
    setErrorGuardado(null);
  };

  const guardar = async () => {
    if (!guardadas || !editadas || guardando) return;
    const enviar = cambiosDePreferencias(guardadas, editadas);
    if (Object.keys(enviar).length === 0) return;

    setGuardando(true);
    setErrorGuardado(null);
    try {
      const confirmadas = await repository.guardar(enviar);
      if (!montado.current) return;
      setGuardadas(confirmadas);
      setEditadas(preferenciasEditables(confirmadas));
      if (onExitoGuardar) onExitoGuardar();
    } catch (err: unknown) {
      if (montado.current) {
        setErrorGuardado(formatearErrorGuardado(err));
      }
    } finally {
      if (montado.current) {
        setGuardando(false);
      }
    }
  };

  const pushHabilitadoEnDispositivo = editadas
    ? canalPushHabilitadoEnDispositivo(editadas.por_push, permisoDispositivo)
    : false;

  const abrirAjustes = useCallback(async () => {
    if (permisosGateway.abrirAjustes) {
      return await permisosGateway.abrirAjustes();
    }
    return false;
  }, [permisosGateway]);

  const pedirPermiso = useCallback(async () => {
    const resultado = await permisosGateway.solicitarPermiso();
    if (montado.current) {
      setPermisoDispositivo(resultado);
      if (resultado === 'denegado') {
        setAlertaPushDispositivo(
          'Permiso denegado en el dispositivo. Las notificaciones push quedan inhabilitadas en este teléfono.'
        );
      } else if (resultado === 'concedido') {
        setAlertaPushDispositivo(null);
      } else if (resultado === 'no_disponible') {
        setAlertaPushDispositivo(
          'Las notificaciones push no están disponibles en este dispositivo o compilación.'
        );
      }
    }
    return resultado;
  }, [permisosGateway]);

  return {
    estadoCarga,
    errorCargaMensaje,
    guardadas,
    editadas,
    guardando,
    errorGuardado,
    alertaPushDispositivo,
    permisoDispositivo,
    pushHabilitadoEnDispositivo,
    hayCambios,
    cambiar,
    descartar,
    guardar,
    reintentar: cargar,
    abrirAjustes,
    solicitarPermiso: pedirPermiso,
    actualizarPermisoDispositivo,
  };
}
