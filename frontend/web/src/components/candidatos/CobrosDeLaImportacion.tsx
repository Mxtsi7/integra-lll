import { useCandidatos } from '../../hooks/useCandidatos';
import { ListaCandidatos } from './ListaCandidatos';

/**
 * S3-CH-06: los cobros que sí se leyeron de una importación, para verlos aparte de las
 * filas con problemas. Es solo lectura: no pasa selección ni decisiones a la lista, así
 * que no hay casillas ni botones de confirmar o rechazar. Esos se ofrecen cuando las
 * operaciones reales estén aceptadas (S3-CH-08 y S3-CH-09).
 */
export function CobrosDeLaImportacion({ importacionId }: { importacionId: string }) {
  const { carga, pagina, irAPagina, recargar } = useCandidatos({ importacion: importacionId });
  return <ListaCandidatos carga={carga} pagina={pagina} alCambiarPagina={irAPagina} alReintentar={recargar} />;
}
