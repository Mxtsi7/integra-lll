import { formatearMonto } from '@ojoalgasto/shared';
import styles from './SummaryCards.module.css';

interface SummaryCardsProps {
  gastoProyectadoMes: number;
  totalProximos7Dias: number;
  cantidadProximos7Dias: number;
  cantidadFantasma: number;
}

export function SummaryCards({
  gastoProyectadoMes,
  totalProximos7Dias,
  cantidadProximos7Dias,
  cantidadFantasma,
}: SummaryCardsProps) {
  return (
    <div className={styles.grid}>
      <div className={styles.card}>
        <p className={styles.etiqueta}>Gasto proyectado este mes</p>
        <p className={styles.valor}>{formatearMonto(gastoProyectadoMes)}</p>
        <p className={styles.pie}>Activas, fantasma y pruebas con cobro conocido (RN-CIC-005)</p>
      </div>

      <div className={`${styles.card} ${styles.cardDestacada}`}>
        <p className={styles.etiqueta}>Próximos cobros (7 días)</p>
        <p className={styles.valor}>{formatearMonto(totalProximos7Dias)}</p>
        <p className={styles.pie}>{cantidadProximos7Dias} suscripciones pendientes de cobro</p>
      </div>

      <div className={styles.card}>
        <p className={styles.etiqueta}>Suscripciones fantasma</p>
        <p className={`${styles.valor} ${styles.valorAlerta}`}>{cantidadFantasma}</p>
        <p className={styles.pie}>Activas sin uso registrado (RN-REC-002)</p>
      </div>
    </div>
  );
}
