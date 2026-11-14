import { useCallback, useEffect, useRef, useState } from 'react';
import { confirmarCorreo } from '@ojoalgasto/shared';
import { estadoDesdeError, type EstadoVerificacion } from './reglasVerificacion';

export interface OpcionesVerificarCorreo {
  /** El token del enlace del correo. Sin token, el enlace no sirve. */
  token: string | undefined;
  /** Confirma el token en el backend. Se reemplaza en las pruebas. */
  onConfirmar?: (token: string) => Promise<void>;
  /** Se llama solo después de que el backend confirmó (por ejemplo, para releer el perfil). */
  onVerificado?: () => void;
}

/**
 * Confirma el correo con el token del enlace (AN-12).
 * El correo solo se muestra verificado cuando el backend responde bien: nada se activa por el
 * texto del enlace. El token es de un solo uso, así que se confirma una sola vez por token;
 * si la pantalla se monta dos veces, la segunda llamada daría "enlace ya usado" aunque la primera funcionara.
 */
export function useVerificarCorreo({ token, onConfirmar = confirmarCorreo, onVerificado }: OpcionesVerificarCorreo) {
  const [estado, setEstado] = useState<EstadoVerificacion>(token ? { tipo: 'verificando' } : { tipo: 'invalido' });
  const tokenYaEnviado = useRef<string | null>(null);
  const generacion = useRef(0);
  const sigueMontado = useRef(true);
  const tokenActual = useRef(token);
  const onVerificadoRef = useRef(onVerificado);

  tokenActual.current = token;
  onVerificadoRef.current = onVerificado;

  useEffect(() => {
    sigueMontado.current = true;
    return () => {
      sigueMontado.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) {
      generacion.current += 1;
      tokenYaEnviado.current = null;
      setEstado({ tipo: 'invalido' });
    }
  }, [token]);

  const confirmar = useCallback(async () => {
    if (!token) return;
    generacion.current += 1;
    const miGeneracion = generacion.current;
    const miToken = token;

    setEstado({ tipo: 'verificando' });
    try {
      await onConfirmar(miToken);
      if (!sigueMontado.current || miGeneracion !== generacion.current || tokenActual.current !== miToken) return;
      setEstado({ tipo: 'verificado' });
      onVerificadoRef.current?.();
    } catch (error) {
      if (!sigueMontado.current || miGeneracion !== generacion.current || tokenActual.current !== miToken) return;
      setEstado(estadoDesdeError(error));
    }
  }, [token, onConfirmar]);

  useEffect(() => {
    if (!token || tokenYaEnviado.current === token) return;
    tokenYaEnviado.current = token;
    void confirmar();
  }, [token, confirmar]);

  return { estado, reintentar: confirmar };
}
