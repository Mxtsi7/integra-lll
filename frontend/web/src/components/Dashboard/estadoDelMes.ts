import type { ResumenDelMes } from '@ojoalgasto/shared';
import type { CargaInforme } from '../../hooks/useInformeMensual';
import { montoComoNumero, sinGastos } from '../Informes/periodosDeInforme';

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

/**
 * Lo que muestra la cifra del mes del Panel (S3-CH-13). Carga, error, ausencia de datos y gasto
 * son cosas distintas: ninguna se muestra como otra.
 */
export type EstadoDelMes =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string; alReintentar: () => void }
  /** Ninguno de los seis meses tiene cobros. El servidor no tiene nada que contar, y no es un cero. */
  | { tipo: 'sin_datos' }
  /** El mes elegido, con su gasto. Puede ser cero: entonces el cero está confirmado por el servidor. */
  | { tipo: 'listo'; gasto: GastoDelMes };

/** Traduce la carga del informe al estado del tile. Usa el último mes, que es el elegido. */
export function estadoDelMesDesde(carga: CargaInforme, alReintentar: () => void): EstadoDelMes {
  if (carga.tipo === 'cargando') return { tipo: 'cargando' };
  if (carga.tipo === 'error') return { tipo: 'error', mensaje: carga.mensaje, alReintentar };
  if (sinGastos(carga.meses)) return { tipo: 'sin_datos' };
  return { tipo: 'listo', gasto: gastoDelMesDe(carga.meses[carga.meses.length - 1]) };
}
