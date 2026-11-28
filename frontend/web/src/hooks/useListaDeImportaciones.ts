import type { Importacion, Paginado } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

export type EstadoListaDeImportaciones =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; importaciones: Importacion[]; hayMas: boolean; pagina: number; cargandoMas: boolean; errorMas: string | null };

const mensajeDe = (error: unknown, mensajeDeFallo: string) => (error instanceof TypeError ? MENSAJE_SIN_RED : mensajeDeFallo);

/**
 * Un listado paginado de importaciones, de la más nueva a la más vieja, con «Ver más».
 *
 * @param pedirPagina la consulta al servidor. Tiene que ser siempre la misma función (por ejemplo
 *   una de `@ojoalgasto/shared`): si cambia en cada render, la lista se vuelve a cargar sin parar.
 * @param mensajeDeFallo lo que se dice cuando falla algo que no es la red.
 */
export function useListaDeImportaciones(
  pedirPagina: (pagina: number) => Promise<Paginado<Importacion>>,
  mensajeDeFallo: string,
) {
  const [estado, setEstado] = useState<EstadoListaDeImportaciones>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);
  // La sesión con que se montó la página. Si cambia, <RutaPrivada> la vuelve
  // a montar: filas y paginación empiezan de cero, y una página de la sesión
  // anterior que llega tarde queda en la página desmontada (revisión de #130).
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);

  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    pedirPagina(1)
      .then((pagina) => {
        if (vigente) {
          setEstado({ tipo: 'listo', importaciones: pagina.results, hayMas: pagina.next !== null, pagina: 1, cargandoMas: false, errorMas: null });
        }
      })
      .catch((error: unknown) => {
        if (vigente) setEstado({ tipo: 'error', mensaje: mensajeDe(error, mensajeDeFallo) });
      });
    return () => {
      vigente = false;
    };
  }, [intento, pedirPagina, mensajeDeFallo]);

  const verMas = async () => {
    if (estado.tipo !== 'listo' || estado.cargandoMas) return;
    // Con la sesión ya cambiada, la lista es de la cuenta anterior: no se pide
    // su página siguiente con el token de la nueva.
    if (capturarSesion() !== sesion) return;
    const siguiente = estado.pagina + 1;
    setEstado({ ...estado, cargandoMas: true, errorMas: null });
    try {
      const pagina = await pedirPagina(siguiente);
      setEstado((actual) =>
        actual.tipo === 'listo'
          ? {
              ...actual,
              // Si entró una nueva mientras tanto, la página corre una posición: no se repite.
              importaciones: [
                ...actual.importaciones,
                ...pagina.results.filter((nueva) => !actual.importaciones.some((existente) => existente.id === nueva.id)),
              ],
              hayMas: pagina.next !== null,
              pagina: siguiente,
              cargandoMas: false,
            }
          : actual,
      );
    } catch (error: unknown) {
      setEstado((actual) => (actual.tipo === 'listo' ? { ...actual, cargandoMas: false, errorMas: mensajeDe(error, mensajeDeFallo) } : actual));
    }
  };

  const reintentar = () => setIntento((anterior) => anterior + 1);

  return { estado, verMas, reintentar };
}
