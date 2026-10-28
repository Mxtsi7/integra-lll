import { conMayuscula, formatearFechaLarga, type CobroCalendario } from '@ojoalgasto/shared';
import { useId } from 'react';
import { textoCobros } from '../../utils/calendario';
import { ListaCobros, TotalesPorMoneda } from './ListaCobros';
import styles from './Calendario.module.css';

interface DetalleDiaProps {
  /** Día elegido, "YYYY-MM-DD". */
  fecha: string;
  /** Cobros de ese día; null mientras se carga el mes o si no se pudo cargar. */
  cobros: CobroCalendario[] | null;
  /** No se pudo cargar el mes: no se dice "sin cobros" porque no se sabe. */
  error?: boolean;
}

/**
 * Detalle del día elegido (CH-20): sus cobros con enlace a cada suscripción
 * y el total por moneda. Elegir otro día cambia solo este panel. El resumen
 * de arriba se anuncia (aria-live) para quien usa lector de pantalla.
 */
export function DetalleDia({ fecha, cobros, error = false }: DetalleDiaProps) {
  const titulo = conMayuscula(formatearFechaLarga(fecha));
  const idTitulo = useId();
  let resumen = 'Cargando cobros…';
  if (error) resumen = 'No pudimos cargar los cobros de este mes.';
  else if (cobros !== null) resumen = conMayuscula(textoCobros(cobros.length));
  return (
    <section className={`tile ${styles.detalle}`} aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className={styles.detalleTitulo}>
        {titulo}
      </h2>
      <p className={styles.detalleResumen} aria-live="polite">
        {resumen}
      </p>

      {cobros !== null && cobros.length === 0 && (
        <p className={styles.mensaje}>Este día no tiene cobros confirmados ni previstos.</p>
      )}

      {cobros !== null && cobros.length > 0 && (
        <>
          <ListaCobros cobros={cobros} etiqueta={`Cobros del ${formatearFechaLarga(fecha)}`} />
          <TotalesPorMoneda cobros={cobros} etiqueta="Total del día" />
        </>
      )}
    </section>
  );
}
