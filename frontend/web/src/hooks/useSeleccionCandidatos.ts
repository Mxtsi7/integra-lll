import { useCallback, useMemo, useState } from 'react';
import type { CandidatoDetectado } from '@ojoalgasto/shared';
import {
  sePuedeConfirmar,
  sePuedeDecidir,
  type SeleccionDeCandidatos,
} from '../components/candidatos/seleccionCandidatos';

const SIN_IDS: ReadonlySet<string> = new Set();

/**
 * S3-CH-07: qué cobros eligió la persona para confirmar o rechazar. Solo estado
 * de la interfaz: no llama a la API (eso es S3-CH-08 y S3-CH-09).
 *
 * `candidatos` es la lista que se ve ahora, o null mientras no hay lista
 * (cargando o con error). La selección es siempre un subconjunto de lo visible
 * que espera una decisión:
 * - un cobro que ya se confirmó o rechazó sale solo, al llegar la lista nueva;
 * - al cambiar de página o de filtro lo que ya no se ve deja de estar seleccionado;
 * - mientras la lista se recarga no se muestra nada seleccionado, y los cobros
 *   que siguen pendientes lo siguen estando cuando llega la lista.
 */
export function useSeleccionCandidatos(candidatos: readonly CandidatoDetectado[] | null): SeleccionDeCandidatos {
  const decidibles = useMemo(() => (candidatos ?? []).filter(sePuedeDecidir), [candidatos]);
  const idsDecidibles = useMemo(() => new Set(decidibles.map((candidato) => candidato.id)), [decidibles]);

  const [elegidos, setElegidos] = useState<ReadonlySet<string>>(SIN_IDS);

  // Con la lista nueva se quitan los que ya no están o ya no esperan decisión.
  // Se ajusta al dibujar y no en un efecto: así nunca se pinta una selección con cobros que no existen.
  const vigentes = useMemo(
    () => (candidatos === null ? SIN_IDS : new Set([...elegidos].filter((id) => idsDecidibles.has(id)))),
    [candidatos, elegidos, idsDecidibles],
  );
  if (candidatos !== null && vigentes.size !== elegidos.size) setElegidos(vigentes);

  // Un id que no esté en la lista, o que ya no espere decisión, entra aquí pero la poda de arriba lo saca
  // en el mismo dibujo: no hace falta comprobarlo.
  const alAlternar = useCallback((id: string) => {
    setElegidos((actuales) => {
      const siguientes = new Set(actuales);
      if (siguientes.has(id)) siguientes.delete(id);
      else siguientes.add(id);
      return siguientes;
    });
  }, []);

  const alAlternarPagina = useCallback(() => {
    setElegidos((actuales) => {
      const estanTodos = idsDecidibles.size > 0 && [...idsDecidibles].every((id) => actuales.has(id));
      return estanTodos ? SIN_IDS : new Set(idsDecidibles);
    });
  }, [idsDecidibles]);

  const alLimpiar = useCallback(() => setElegidos(SIN_IDS), []);

  const idsParaConfirmar = useMemo(
    () => decidibles.filter((candidato) => vigentes.has(candidato.id) && sePuedeConfirmar(candidato)).map((candidato) => candidato.id),
    [decidibles, vigentes],
  );

  return {
    seleccionados: vigentes,
    idsParaConfirmar,
    cantidadSeleccionable: decidibles.length,
    alAlternar,
    alAlternarPagina,
    alLimpiar,
  };
}
