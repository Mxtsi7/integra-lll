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

export function useRecomendaciones() {
  const [estado, setEstado] = useState<EstadoRecomendaciones>({ tipo: 'cargando' });

  const cargarRecomendaciones = useCallback(async () => {
    setEstado({ tipo: 'cargando' });
    try {
      // Petición real al endpoint VI-17
      const data = await pedir<Recomendacion[]>('/recomendaciones');
      setEstado({ tipo: 'listo', items: Array.isArray(data) ? data : [] });
    } catch (err: any) {
      // Si la API no está lista o falla, se representa explícitamente el error
      setEstado({
        tipo: 'error',
        mensaje: err.message || 'El servicio de recomendaciones no está disponible actualmente.'
      });
    }
  }, []);

  const quitar = (id: string) => {
    if (estado.tipo === 'listo') {
      setEstado({
        tipo: 'listo',
        items: estado.items.filter((item) => item.id !== id)
      });
    }
  };

  useEffect(() => {
    cargarRecomendaciones();
  }, [cargarRecomendaciones]);

  return { estado, quitar, recargar: cargarRecomendaciones };
}
