import { sumarEquivalentesMensuales, formatearMonto, type ResumenDelMes, type Suscripcion } from '@ojoalgasto/shared';
import { montoComoNumero } from '../Informes/periodosDeInforme';
import { CalendarClock, Ghost, Home, Layers } from 'lucide-react';
import { diasHasta } from '../../utils/fechas';
import { useConteo } from '../../hooks/useConteo';
import styles from './Tiles.module.css';

/** El gasto de un mes en una moneda, de Analytics (VI-06): lo cobrado, lo que falta y el total. */
export interface GastoDelMes {
  real: number;
  proyectado: number;
  total: number;
}

/** La respuesta del servidor, en números para mostrar. Los montos llegan como texto. */
export function gastoDelMesDe(resumen: ResumenDelMes): GastoDelMes {
  return {
    real: montoComoNumero(resumen.gasto_real),
    proyectado: montoComoNumero(resumen.gasto_proyectado),
    total: montoComoNumero(resumen.total_estimado),
  };
}

interface TileResumenProps {
  suscripciones: Suscripcion[];
  moneda: string;
  nombreHogar: string;
  /** El gasto del mes elegido. Mientras no llega es null: no se muestra un cero que no existe. */
  gastoDelMes: GastoDelMes | null;
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
 * La cifra del mes es la que da Analytics (VI-06), no un cálculo con las suscripciones cargadas.
 */
export function TileResumen({ suscripciones, moneda, nombreHogar, gastoDelMes }: TileResumenProps) {
  const total = gastoDelMes?.total ?? null;
  const sinUso = sumarEquivalentesMensuales(suscripciones.filter((s) => s.estado === 'fantasma'));
  const activas = suscripciones.filter((s) => s.estado === 'activo' || s.estado === 'fantasma').length;
  const semana = suscripciones
    .filter((s) => s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0 && diasHasta(s.fecha_proximo_cobro) <= 7)
    .reduce((suma, s) => suma + s.monto, 0);
  // La cifra cuenta desde cero al abrir: es la primera cosa que se mira.
  const totalMostrado = useConteo(total ?? 0, 1100);

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
            {total === null ? '—' : formatearMonto(totalMostrado, moneda)}
            <span className={styles.resumenCifraSufijo}>al mes</span>
          </p>
          <p className={styles.resumenDescripcion}>
            {activas === 1 ? 'Una suscripción activa' : `${activas} suscripciones activas`}
          </p>
          {gastoDelMes && (
            <p className={styles.resumenDescripcion}>
              Ya cobrado {formatearMonto(gastoDelMes.real, moneda)} · por cobrar {formatearMonto(gastoDelMes.proyectado, moneda)}
            </p>
          )}
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
