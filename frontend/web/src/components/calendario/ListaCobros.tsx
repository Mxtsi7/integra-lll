import { formatearMonto, totalesPorMoneda, type CobroCalendario } from '@ojoalgasto/shared';
import { Link } from 'react-router-dom';
import { Insignia } from '../ui/Insignia';
import { PRESENTACION_TIPO } from './presentacion';
import styles from './Calendario.module.css';

/**
 * Cobros en filas: servicio (enlace al detalle de la suscripción), si está
 * confirmado o previsto, y el importe en su moneda. La usan el detalle del
 * día (CH-20) y la Agenda (CH-21), así ambos se ven y se leen igual.
 */
export function ListaCobros({ cobros, etiqueta }: { cobros: CobroCalendario[]; etiqueta: string }) {
  return (
    <ul className={styles.listaCobros} aria-label={etiqueta}>
      {cobros.map((cobro) => {
        const tipo = PRESENTACION_TIPO[cobro.tipo];
        return (
          <li key={cobro.id} className={styles.filaCobro} data-tipo={cobro.tipo}>
            <Link to={`/suscripciones/${cobro.suscripcion_id}`} className={styles.filaServicio}>
              {cobro.servicio}
            </Link>
            <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
            <span className={styles.filaImporte}>{formatearMonto(cobro.importe, cobro.moneda)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * "Total del día: $15.980 y US$4,99". Cada moneda por separado: sumar pesos
 * con dólares daría un número que no es ninguna de las dos cosas.
 */
export function TotalesPorMoneda({ cobros, etiqueta }: { cobros: CobroCalendario[]; etiqueta: string }) {
  const totales = totalesPorMoneda(cobros);
  if (totales.length === 0) return null;
  return (
    <p className={styles.total}>
      {etiqueta}:{' '}
      {totales.map(({ moneda, total }, i) => (
        <span key={moneda}>
          {i > 0 && ' y '}
          <strong>{formatearMonto(total, moneda)}</strong>
        </span>
      ))}
    </p>
  );
}
