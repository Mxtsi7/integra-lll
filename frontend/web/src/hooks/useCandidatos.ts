import { useCallback, useEffect, useState } from 'react';
import { ErrorDeApi, getCandidatos, type ConsultaCandidatos } from '@ojoalgasto/shared';
import type { CargaCandidatos } from '../components/candidatos/cargaCandidatos';
import { useAuth } from '../context/AuthContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

type FiltrosCandidatos = Omit<ConsultaCandidatos, 'pagina'>;

export const MENSAJE_ERROR_CANDIDATOS = 'No pudimos cargar los cobros encontrados. Intenta de nuevo.';

function mensajeDeError(error: unknown): string {
  return error instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_CANDIDATOS;
}

/**
 * S3-CH-04: carga la página de candidatos detectados. Cambiar un filtro vuelve
 * a la página 1: la página que se pidió antes puede no existir con el filtro nuevo.
 */
export function useCandidatos({ origen, estado, importacion }: FiltrosCandidatos = {}) {
  const { capturarSesion } = useAuth();
  // La sesión con la que se montó la lista. Si cambia, la respuesta que llegue
  // después no se muestra: es de otra sesión.
  const [sesion] = useState(capturarSesion);

  const clavePorFiltros = JSON.stringify([origen ?? null, estado ?? null, importacion ?? null]);
  // La página guarda con qué filtros se eligió: si los filtros cambian, vuelve a 1
  // sin necesidad de un efecto que la reinicie.
  const [paginaElegida, setPaginaElegida] = useState({ clave: clavePorFiltros, numero: 1 });
  const pagina = paginaElegida.clave === clavePorFiltros ? paginaElegida.numero : 1;

  const [recargas, setRecargas] = useState(0);
  const [carga, setCarga] = useState<CargaCandidatos>({ tipo: 'cargando' });

  useEffect(() => {
    let vigente = true;
    const sigueVigente = () => vigente && capturarSesion() === sesion;
    setCarga({ tipo: 'cargando' });
    getCandidatos({ origen, estado, importacion, pagina })
      .then((datos) => {
        if (sigueVigente()) setCarga({ tipo: 'listo', datos });
      })
      .catch((error: unknown) => {
        if (!sigueVigente()) return;
        // La página ya no existe: se confirmaron o rechazaron los cobros que la
        // llenaban. Se vuelve a la anterior. Un error ahí no lo arreglaría
        // Reintentar, porque pediría otra vez la misma página.
        if (error instanceof ErrorDeApi && error.status === 404 && pagina > 1) {
          setPaginaElegida({ clave: clavePorFiltros, numero: pagina - 1 });
          return;
        }
        setCarga({ tipo: 'error', mensaje: mensajeDeError(error) });
      });
    return () => {
      vigente = false;
    };
  }, [origen, estado, importacion, pagina, clavePorFiltros, recargas, capturarSesion, sesion]);

  const irAPagina = useCallback(
    (numero: number) => setPaginaElegida({ clave: clavePorFiltros, numero }),
    [clavePorFiltros],
  );
  const recargar = useCallback(() => setRecargas((actual) => actual + 1), []);

  return { carga, pagina, irAPagina, recargar };
}
