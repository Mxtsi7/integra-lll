import { costoPorHora, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import styles from './FantasmaHighlight.module.css';

interface FantasmaHighlightProps {
  suscripciones: Suscripcion[];
}

export function FantasmaHighlight({ suscripciones }: FantasmaHighlightProps) {
  const fantasmas = suscripciones.filter((s) => s.estado === 'fantasma');

  if (fantasmas.length === 0) {
    return null; // No hay nada que destacar: no ensuciamos el panel con una tarjeta vacía.
  }

  return (
    <section className={styles.panel}>
      <h2 className={styles.titulo}>
        <span aria-hidden="true">👻</span> Suscripciones fantasma
      </h2>
      <p className={styles.subtitulo}>
        Siguen activas y cobrando, pero llevan 45+ días sin uso registrado (RN-REC-002).
      </p>

      <ul className={styles.lista}>
        {fantasmas.map((s) => {
          const porHora = costoPorHora(s.monto, s.horas_uso_mes ?? 0);
          return (
            <li key={s.id} className={styles.fila}>
              <span className={styles.nombre}>{s.nombre}</span>
              <span className={styles.detalle}>
                {formatearMonto(s.monto, s.moneda)}
                {s.frecuencia === 'mensual' ? '/mes' : '/año'}
                {porHora !== null && ` · sin uso este mes`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
