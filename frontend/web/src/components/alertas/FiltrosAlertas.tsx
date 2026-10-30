import styles from './FiltrosAlertas.module.css';

/** «Todas» no manda filtro; las otras dos son el `?lectura=` de FE-19. */
export type FiltroAlertas = 'todas' | 'pendiente' | 'leida';

export const FILTROS_ALERTAS: readonly { valor: FiltroAlertas; etiqueta: string }[] = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'pendiente', etiqueta: 'Sin leer' },
  { valor: 'leida', etiqueta: 'Leídas' },
];

/** Un valor de la URL que no es un filtro conocido vale «Todas». */
export function leerFiltroAlertas(valor: string | null): FiltroAlertas {
  return valor === 'pendiente' || valor === 'leida' ? valor : 'todas';
}

interface FiltrosAlertasProps {
  valor: FiltroAlertas;
  alCambiar: (filtro: FiltroAlertas) => void;
  /** Las sin leer de toda la organización, para el chip «Sin leer». null mientras no se sabe. */
  pendientes: number | null;
}

/** Los chips de lectura del Centro de alertas (SE-01). El filtro lo aplica el servidor. */
export function FiltrosAlertas({ valor, alCambiar, pendientes }: FiltrosAlertasProps) {
  return (
    <div className={styles.filtros} role="group" aria-label="Filtrar alertas">
      {FILTROS_ALERTAS.map((f) => (
        <button
          key={f.valor}
          type="button"
          className={valor === f.valor ? `${styles.filtro} ${styles.filtroActivo}` : styles.filtro}
          aria-pressed={valor === f.valor}
          onClick={() => alCambiar(f.valor)}
        >
          {f.etiqueta}
          {f.valor === 'pendiente' && pendientes !== null && <span className={styles.filtroConteo}>{pendientes}</span>}
        </button>
      ))}
    </div>
  );
}
