import { useState, useEffect } from 'react';

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

  const cargarRecomendaciones = async () => {
    setEstado({ tipo: 'cargando' });
    try {
      // Punto de integración con la API real / Entrega VI-17
      setEstado({ tipo: 'listo', items: [] });
    } catch (err: any) {
      setEstado({
        tipo: 'error',
        mensaje: err.message || 'Error al obtener las recomendaciones.'
      });
    }
  };

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
  }, []);

  return { estado, quitar, recargar: cargarRecomendaciones };
}
