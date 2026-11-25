import { useCandidatos } from '../../hooks/useCandidatos';
import { useDecisionesDeCandidatos } from '../../hooks/useDecisionesDeCandidatos';
import { useSeleccionCandidatos } from '../../hooks/useSeleccionCandidatos';
import { ListaCandidatos } from './ListaCandidatos';

interface RevisionDeCandidatosProps {
  /** La importación cuyos cobros se revisan. */
  importacion: string;
}

/**
 * S3-CH-07, S3-CH-08 y S3-CH-09: la lista de los cobros de una importación con su selección y
 * sus decisiones. Después de confirmar o rechazar vuelve a leer la página del servidor, para que
 * lo que se ve sea lo que el servidor guardó.
 */
export function RevisionDeCandidatos({ importacion }: RevisionDeCandidatosProps) {
  const { carga, pagina, irAPagina, recargar } = useCandidatos({ importacion });
  const candidatos = carga.tipo === 'listo' ? carga.datos.results : null;
  const seleccion = useSeleccionCandidatos(candidatos);
  const { accionEnCurso, resultado, confirmar, rechazar, cerrarResultado } = useDecisionesDeCandidatos({ alTerminar: recargar });

  const elegidos = (candidatos ?? []).filter((cobro) => seleccion.seleccionados.has(cobro.id));
  const alConfirmar = () => void confirmar(elegidos.filter((cobro) => seleccion.idsParaConfirmar.includes(cobro.id)));
  const alRechazar = () => void rechazar(elegidos);

  return (
    <ListaCandidatos
      carga={carga}
      pagina={pagina}
      alCambiarPagina={irAPagina}
      alReintentar={recargar}
      seleccion={seleccion}
      decisiones={{ accionEnCurso, resultado, alConfirmar, alRechazar, alCerrarResultado: cerrarResultado }}
    />
  );
}
