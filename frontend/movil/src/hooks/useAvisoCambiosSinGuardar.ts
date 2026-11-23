import { useCallback, useEffect, useId, useInsertionEffect, useRef, useState } from 'react';
import React from 'react';
import { BackHandler } from 'react-native';
import {
  NavigationContext,
  NavigationRouteContext,
  PreventRemoveContext,
} from '@react-navigation/native';

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
 * Implementa de forma integral y robusta el contrato de usePreventRemove (@react-navigation/native):
 * 1. Coordina con PreventRemoveContext en createNativeStackNavigator (native-stack de React Navigation v7)
 *    para activar preventNativeDismiss en react-native-screens, evitando que gestos swipe de iOS o botones
 *    del header nativo destruyan la pantalla nativa antes de confirmar.
 * 2. Conecta el listener beforeRemove de React Navigation (tanto en native-stack como en navegación simulada/manual).
 * 3. Intercepta el botón físico hardwareBackPress de Android (BackHandler).
 * 4. Maneja la salida interna mediante intentarSalir ("Cancelar y Volver").
 * 5. Mantiene compatibilidad total con pruebas unitarias aisladas donde NavigationContainer no está presente.
 */
export function useAvisoCambiosSinGuardar({
  hayCambios,
  navigation: navigationProp,
}: UseAvisoCambiosSinGuardarOptions): UseAvisoCambiosSinGuardarResult {
  const [mostrandoAviso, setMostrandoAviso] = useState(false);
  const [bypass, setBypass] = useState(false);
  const accionPendienteRef = useRef<any>(null);
  const bypassRef = useRef(false);

  const id = useId();
  const navContext = React.useContext<any>(NavigationContext as any);
  const routeContext = React.useContext<any>(NavigationRouteContext as any);
  const preventRemoveContext = React.useContext<any>(PreventRemoveContext as any);

  const routeKey = routeContext?.key;
  const setPreventRemove = preventRemoveContext?.setPreventRemove;
  const notifyPreventRemove = preventRemoveContext?.notifyPreventRemove;

  const shouldPreventRemove = hayCambios && !bypass && !bypassRef.current;

  // Sincronizar estado cuando hayCambios vuelve a false
  useEffect(() => {
    if (!hayCambios) {
      setMostrandoAviso(false);
      accionPendienteRef.current = null;
      bypassRef.current = false;
      setBypass(false);
    }
  }, [hayCambios]);

  // 1. Coordinación nativa con PreventRemoveContext de React Navigation (native-stack)
  // Al registrar shouldPreventRemove, NativeStackView activa preventNativeDismiss en ScreenStackItem (iOS/Android)
  useInsertionEffect(() => {
    if (!setPreventRemove || !routeKey) return;
    setPreventRemove(id, routeKey, shouldPreventRemove);

    return () => {
      setPreventRemove(id, routeKey, false);
    };
  }, [setPreventRemove, id, routeKey, shouldPreventRemove]);

  useEffect(() => {
    if (!notifyPreventRemove) return;
    notifyPreventRemove();

    return () => {
      notifyPreventRemove();
    };
  }, [id, routeKey, shouldPreventRemove, notifyPreventRemove]);

  // 2. Interceptar navegación de React Navigation (beforeRemove)
  const nav = navigationProp ?? navContext;

  useEffect(() => {
    if (!nav?.addListener) return;

    const unsubscribe = nav.addListener('beforeRemove', (e: any) => {
      if (bypassRef.current || !hayCambios) {
        return;
      }

      e.preventDefault();
      accionPendienteRef.current = e.data?.action;
      setMostrandoAviso(true);
    });

    return unsubscribe;
  }, [nav, hayCambios]);

  // 3. Interceptar botón hardware Back de Android
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
    setBypass(true);

    if (setPreventRemove && routeKey) {
      setPreventRemove(id, routeKey, false);
      notifyPreventRemove?.();
    }

    const action = accionPendienteRef.current;
    accionPendienteRef.current = null;

    if (action && nav?.dispatch) {
      nav.dispatch(action);
    } else if (nav?.goBack) {
      nav.goBack();
    }
  }, [id, nav, notifyPreventRemove, routeKey, setPreventRemove]);

  const limpiarAvisoTrasGuardar = useCallback(() => {
    bypassRef.current = true;
    setBypass(true);
    setMostrandoAviso(false);
    accionPendienteRef.current = null;

    if (setPreventRemove && routeKey) {
      setPreventRemove(id, routeKey, false);
      notifyPreventRemove?.();
    }
  }, [id, notifyPreventRemove, routeKey, setPreventRemove]);

  const intentarSalir = useCallback(() => {
    if (!hayCambios) {
      if (nav?.goBack) {
        nav.goBack();
      }
      return;
    }
    setMostrandoAviso(true);
  }, [hayCambios, nav]);

  return {
    mostrandoAviso,
    seguirEditando,
    descartarCambios,
    limpiarAvisoTrasGuardar,
    intentarSalir,
  };
}

export default useAvisoCambiosSinGuardar;

