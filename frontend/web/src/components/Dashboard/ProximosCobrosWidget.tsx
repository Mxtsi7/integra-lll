import { formatearFecha, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Link } from 'react-router-dom';
import { diasHasta } from '../../utils/fechas';
import styles from './ProximosCobrosWidget.module.css';

interface ProximosCobrosWidgetProps {
  suscripciones: Suscripcion[];
}

export function ProximosCobrosWidget({ suscripciones }: ProximosCobrosWidgetProps) {
  const proximos = suscripciones
    .filter((s) => s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0 && diasHasta(s.fecha_proximo_cobro) <= 7)
    .sort((a, b) => diasHasta(a.fecha_proximo_cobro) - diasHasta(b.fecha_proximo_cobro));

  return (
    <section className={styles.panel}>
      <h2 className={styles.titulo}>
        <span className={styles.barra} aria-hidden="true" />
        Próximos cobros
      </h2>

      {proximos.length === 0 ? (
        <p className={styles.vacio}>No tienes cobros programados en los próximos 7 días.</p>
      ) : (
        <ul className={styles.lista}>
          {proximos.map((s) => {
            const dias = diasHasta(s.fecha_proximo_cobro);
            return (
              <li key={s.id}>
                <Link to={`/suscripciones/${s.id}`} className={styles.fila}>
                  <div>
                    <p className={styles.nombre}>{s.nombre}</p>
                    <p className={styles.fecha}>
                      {dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : `En ${dias} días`} ·{' '}
                      {formatearFecha(s.fecha_proximo_cobro)}
                    </p>
                  </div>
                  <span className={styles.monto}>{formatearMonto(s.monto, s.moneda)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
