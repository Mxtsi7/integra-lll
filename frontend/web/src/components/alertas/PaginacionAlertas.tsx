import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Boton } from '../ui/Boton';
import styles from './PaginacionAlertas.module.css';

interface PaginacionAlertasProps {
  pagina: number;
  totalPaginas: number;
  /** Lo dicen `previous` y `next` del servidor, no la cuenta: son lo que de verdad existe. */
  hayAnterior: boolean;
  haySiguiente: boolean;
  alCambiar: (pagina: number) => void;
}

/**
 * Páginas numeradas y no «Ver más». Una alerta que se lee con el filtro
 * «Sin leer» sale del filtro y corre las de atrás: acumulando páginas, la que
 * pasó a ocupar su lugar quedaría sin verse. Así cada página es la del servidor.
 */
export function PaginacionAlertas({ pagina, totalPaginas, hayAnterior, haySiguiente, alCambiar }: PaginacionAlertasProps) {
  return (
    <nav className={styles.paginacion} aria-label="Páginas de alertas">
      <Boton
        variante="secundario"
        tamano="s"
        icono={<ChevronLeft size={15} aria-hidden="true" />}
        disabled={!hayAnterior}
        onClick={() => alCambiar(pagina - 1)}
      >
        Anterior
      </Boton>
      <span className={styles.texto} aria-live="polite">
        Página {pagina} de {Math.max(pagina, totalPaginas)}
      </span>
      <Boton variante="secundario" tamano="s" disabled={!haySiguiente} onClick={() => alCambiar(pagina + 1)}>
        Siguiente
        <ChevronRight size={15} aria-hidden="true" />
      </Boton>
    </nav>
  );
}
