import { useState, useEffect, useCallback } from 'react';
import { pedir } from '../../../shared/src/api/cliente';

export interface Recomendacion {
  id: string;
  suscripcion_id?: string;
  nombre?: string;
  titulo?: string;
  motivo?: string;
  ahorro_estimado?: number;
  moneda?: string;
  total?: number;
}

export type EstadoRecomendaciones =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; items: Recomendacion[] };


function extraerItems(data: unknown): Recomendacion[] | null {
  if (Array.isArray(data)) return data as Recomendacion[];
  if (typeof data === 'object' && data !== null) {
    const results = (data as { results?: unknown }).results;
    if (Array.isArray(results)) return results as Recomendacion[];
  }
  return null;
}

export function useRecomendaciones() {
  const [estado, setEstado] = useState<EstadoRecomendaciones>({ tipo: 'cargando' });

  const cargarRecomendaciones = useCallback(async () => {
    setEstado({ tipo: 'cargando' });
    try {

      const data = await pedir<unknown>('/recomendaciones/');
      const items = extraerItems(data);
      if (items === null) {
        setEstado({ tipo: 'error', mensaje: 'El servicio respondió en un formato inesperado.' });
        return;
      }
      setEstado({ tipo: 'listo', items });
    } catch (err: unknown) {
      setEstado({
        tipo: 'error',
        mensaje:
          err instanceof Error && err.message
            ? err.message
            : 'El servicio de recomendaciones no está disponible actualmente.',
      });
    }
  }, []);

  const quitar = (id: string) => {
    setEstado((e) => (e.tipo === 'listo' ? { tipo: 'listo', items: e.items.filter((i) => i.id !== id) } : e));
  };

  useEffect(() => {
    cargarRecomendaciones();
  }, [cargarRecomendaciones]);

  return { estado, quitar, recargar: cargarRecomendaciones };
}
