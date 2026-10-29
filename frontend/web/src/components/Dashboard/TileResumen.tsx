import { gastoProyectado, sumarEquivalentesMensuales, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { CalendarClock, Ghost, Home, Layers } from 'lucide-react';
import { diasHasta } from '../../utils/fechas';
import { useConteo } from '../../hooks/useConteo';
import styles from './Tiles.module.css';

interface TileResumenProps {
  suscripciones: Suscripcion[];
  moneda: string;
  nombreHogar: string;
}

function fechaDeHoy(): string {
  const texto = new Intl.DateTimeFormat('es-CL', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date());
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * La cifra del mes, como la tarjeta del clima: dónde estás, qué día es,
 * el número grande, y tres datos chicos debajo.
 *
 * Mismo criterio que gastoProyectado() en shared/calculos.ts (RN-CIC-005).
 */
export function TileResumen({ suscripciones, moneda, nombreHogar }: TileResumenProps) {
  const total = gastoProyectado(suscripciones);
  const sinUso = sumarEquivalentesMensuales(suscripciones.filter((s) => s.estado === 'fantasma'));
  const activas = suscripciones.filter((s) => s.estado === 'activo' || s.estado === 'fantasma').length;
  const semana = suscripciones
    .filter((s) => s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0 && diasHasta(s.fecha_proximo_cobro) <= 7)
    .reduce((suma, s) => suma + s.monto, 0);
  // La cifra cuenta desde cero al abrir: es la primera cosa que se mira.
  const totalMostrado = useConteo(total, 1100);

  return (
    <section className={`tile ${styles.tile}`} aria-label="Resumen del mes">
      <div className={styles.resumenFila}>
        <span className={styles.resumenLugar}>
          <Home size={14} aria-hidden="true" />
          {nombreHogar}
        </span>
        <span>{fechaDeHoy()}</span>
      </div>

      <div className={styles.resumenCuerpo}>
        <span className={styles.resumenOrbe} aria-hidden="true" />
        <div>
          <p className={styles.resumenCifra}>
            {formatearMonto(totalMostrado, moneda)}
            <span className={styles.resumenCifraSufijo}>al mes</span>
          </p>
          <p className={styles.resumenDescripcion}>
            {activas === 1 ? 'Una suscripción activa' : `${activas} suscripciones activas`}
          </p>
        </div>
      </div>

      <div className={styles.resumenDatos}>
        <div className={styles.resumenDato}>
          <span className={styles.resumenDatoIcono}>
            <Layers size={16} aria-hidden="true" />
          </span>
          <span className={styles.resumenDatoTexto}>
            <span className={styles.resumenDatoEtiqueta}>Registradas</span>
            <span className={styles.resumenDatoValor}>{suscripciones.length}</span>
          </span>
        </div>
        <div className={styles.resumenDato}>
          <span className={styles.resumenDatoIcono}>
            <CalendarClock size={16} aria-hidden="true" />
          </span>
          <span className={styles.resumenDatoTexto}>
            <span className={styles.resumenDatoEtiqueta}>Esta semana</span>
            <span className={styles.resumenDatoValor}>{formatearMonto(semana, moneda)}</span>
          </span>
        </div>
        <div className={`${styles.resumenDato} ${sinUso > 0 ? styles.resumenDatoCoral : ''}`}>
          <span className={styles.resumenDatoIcono}>
            <Ghost size={16} aria-hidden="true" />
          </span>
          <span className={styles.resumenDatoTexto}>
            <span className={styles.resumenDatoEtiqueta}>Sin uso</span>
            <span className={styles.resumenDatoValor}>{formatearMonto(sinUso, moneda)}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
