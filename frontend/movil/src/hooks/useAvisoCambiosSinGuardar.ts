import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';

export interface UseAvisoCambiosSinGuardarOptions {
  hayCambios: boolean;
  navigation?: any;
}

export interface UseAvisoCambiosSinGuardarResult {
  mostrandoAviso: boolean;
  seguirEditando: () => void;
  descartarCambios: () => void;
  limpiarAvisoTrasGuardar: () => void;
  intentarSalir: () => void;
}

/**
 * Hook para interceptar la navegación y advertir cambios sin guardar en móvil (SE-31).
 * Intercepta:
 * 1. Evento beforeRemove de React Navigation (gestos swipe, botón atrás del header, pop/goBack).
 * 2. Evento hardwareBackPress de Android (BackHandler).
 * 3. Botones internos de salida ("Cancelar y Volver").
 */
export function useAvisoCambiosSinGuardar({
  hayCambios,
  navigation,
}: UseAvisoCambiosSinGuardarOptions): UseAvisoCambiosSinGuardarResult {
  const [mostrandoAviso, setMostrandoAviso] = useState(false);
  const accionPendienteRef = useRef<any>(null);
  const bypassRef = useRef(false);

  // Sincronizar estado de bypass cuando hayCambios vuelve a false
  useEffect(() => {
    if (!hayCambios) {
      setMostrandoAviso(false);
      accionPendienteRef.current = null;
    }
  }, [hayCambios]);

  // Interceptar navegación de React Navigation (beforeRemove)
  useEffect(() => {
    if (!navigation?.addListener) return;

    const unsubscribe = navigation.addListener('beforeRemove', (e: any) => {
      // Si bypass está activo (por guardado o descarte) o si no hay cambios
      if (bypassRef.current || !hayCambios) {
        return;
      }

      // Prevenir la salida inmediata
      e.preventDefault();
      accionPendienteRef.current = e.data?.action;
      setMostrandoAviso(true);
    });

    return unsubscribe;
  }, [navigation, hayCambios]);

  // Interceptar botón hardware Back de Android
  useEffect(() => {
    if (!hayCambios) return;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (bypassRef.current) return false;
      if (mostrandoAviso) {
        // Si el aviso ya está visible, presionar Atrás actúa como "Seguir editando"
        setMostrandoAviso(false);
        accionPendienteRef.current = null;
        return true;
      }
      setMostrandoAviso(true);
      return true;
    });

    return () => {
      subscription.remove();
    };
  }, [hayCambios, mostrandoAviso]);

  const seguirEditando = useCallback(() => {
    setMostrandoAviso(false);
    accionPendienteRef.current = null;
  }, []);

  const descartarCambios = useCallback(() => {
    setMostrandoAviso(false);
    bypassRef.current = true;

    if (accionPendienteRef.current && navigation?.dispatch) {
      navigation.dispatch(accionPendienteRef.current);
    } else if (navigation?.goBack) {
      navigation.goBack();
    }
  }, [navigation]);

  const limpiarAvisoTrasGuardar = useCallback(() => {
    bypassRef.current = true;
    setMostrandoAviso(false);
    accionPendienteRef.current = null;
  }, []);

  const intentarSalir = useCallback(() => {
    if (!hayCambios) {
      if (navigation?.goBack) {
        navigation.goBack();
      }
      return;
    }
    setMostrandoAviso(true);
  }, [hayCambios, navigation]);

  return {
    mostrandoAviso,
    seguirEditando,
    descartarCambios,
    limpiarAvisoTrasGuardar,
    intentarSalir,
  };
}

export default useAvisoCambiosSinGuardar;
