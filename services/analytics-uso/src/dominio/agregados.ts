/**
 * Proyección de milisegundos exactos a minutos enteros.
 *
 * El contrato pide conservar el residuo por día local:
 *
 *   minutos_netos = total_ms // 60000
 *   ms_residuo    = total_ms % 60000
 *
 * No se trasladan residuos a otro día. 30 s + 30 s del mismo día sí son un
 * minuto; 30 s del lunes y 30 s del martes no son un minuto de ningún día.
 */

export interface ProyeccionMinutos {
  readonly msNetos: number;
  readonly minutosNetos: number;
  readonly msResiduo: number;
}

export function proyectarMinutos(msNetos: number): ProyeccionMinutos {
  if (!Number.isSafeInteger(msNetos) || msNetos < 0) {
    throw new RangeError(`milisegundos inválidos: ${msNetos}`);
  }
  const minutosNetos = Math.floor(msNetos / 60_000);
  return {
    msNetos,
    minutosNetos,
    msResiduo: msNetos % 60_000,
  };
}

/**
 * Suma de minutos diarios ya proyectados.
 *
 * El mensual no vuelve a dividir la suma de milisegundos: suma los minutos
 * enteros de cada día. Así un residuo diario no se convierte en un minuto
 * mensual artificial.
 */
export function sumarMinutosDiarios(minutosPorDia: readonly number[]): number {
  return minutosPorDia.reduce((total, minutos) => {
    if (!Number.isSafeInteger(minutos) || minutos < 0) {
      throw new RangeError(`minutos inválidos: ${minutos}`);
    }
    return total + minutos;
  }, 0);
}
