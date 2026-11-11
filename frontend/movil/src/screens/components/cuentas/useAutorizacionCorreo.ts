import { useCallback, useEffect, useRef, useState } from 'react';
import { esUrlAutorizacionValida, iniciarAutorizacionCorreo, type ProveedorCorreo } from '@ojoalgasto/shared';

/** La llamada al backend. Se reemplaza en las pruebas por una función falsa. */
export interface ApiAutorizacion {
  iniciarAutorizacionCorreo: typeof iniciarAutorizacionCorreo;
}

const API_REAL: ApiAutorizacion = { iniciarAutorizacionCorreo };

export type EstadoAutorizacion =
  | { tipo: 'inactiva' }
  | { tipo: 'iniciando'; proveedor: ProveedorCorreo }
  /** Ya se abrió el navegador. No sabemos si la persona terminó o canceló: la lista de cuentas lo dirá. */
  | { tipo: 'esperando'; proveedor: ProveedorCorreo }
  | { tipo: 'error'; mensaje: string };

export const MENSAJES_AUTORIZACION = {
  fallaInicio: 'No pudimos iniciar la conexión. Inténtalo de nuevo.',
  urlInsegura: 'La página que recibimos no es la del proveedor, así que no la abrimos.',
  fallaNavegador: 'No pudimos abrir el navegador. Inténtalo de nuevo.',
} as const;

/**
 * Inicia la autorización de Gmail u Outlook (AN-09).
 * Esto NO conecta ninguna cuenta: solo abre la página del proveedor. La cuenta
 * se crea en el backend cuando el proveedor devuelve el código (callback, AN-27).
 * Por eso cancelar en el navegador no deja nada conectado.
 */
export function useAutorizacionCorreo(
  abrirUrl: (url: string) => Promise<unknown>,
  api: ApiAutorizacion = API_REAL,
) {
  const [estado, setEstado] = useState<EstadoAutorizacion>({ tipo: 'inactiva' });
  const estaEnCurso = useRef(false); // candado contra doble toque
  const sigueMontado = useRef(true);
  // Identifica el intento vigente. Al salir de la pantalla sube, y la respuesta de un intento
  // abandonado deja de ser vigente: así no abre el navegador cuando la persona ya se fue.
  const numeroDeIntento = useRef(0);

  useEffect(() => {
    sigueMontado.current = true;
    return () => {
      sigueMontado.current = false;
      numeroDeIntento.current += 1;
    };
  }, []);

  const iniciar = useCallback(
    async (proveedor: ProveedorCorreo) => {
      if (estaEnCurso.current) return;
      estaEnCurso.current = true;
      numeroDeIntento.current += 1;
      const miIntento = numeroDeIntento.current;
      const esIntentoVigente = () => sigueMontado.current && miIntento === numeroDeIntento.current;
      setEstado({ tipo: 'iniciando', proveedor });

      const terminar = (nuevoEstado: EstadoAutorizacion) => {
        if (esIntentoVigente()) setEstado(nuevoEstado);
      };

      try {
        const autorizacion = await api.iniciarAutorizacionCorreo(proveedor);
        // Si la persona salió de la pantalla mientras esperaba, esta respuesta ya no le sirve.
        if (!esIntentoVigente()) return;
        // No se confía en la URL que llega: debe ser https y del dominio del proveedor pedido.
        if (!esUrlAutorizacionValida(proveedor, autorizacion.url_autorizacion)) {
          terminar({ tipo: 'error', mensaje: MENSAJES_AUTORIZACION.urlInsegura });
          return;
        }
        try {
          await abrirUrl(autorizacion.url_autorizacion);
        } catch {
          terminar({ tipo: 'error', mensaje: MENSAJES_AUTORIZACION.fallaNavegador });
          return;
        }
        terminar({ tipo: 'esperando', proveedor });
      } catch {
        terminar({ tipo: 'error', mensaje: MENSAJES_AUTORIZACION.fallaInicio });
      } finally {
        estaEnCurso.current = false;
      }
    },
    [api, abrirUrl],
  );

  return { estado, iniciar };
}
