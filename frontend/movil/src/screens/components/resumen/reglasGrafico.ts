import { formatearMonto, type GastoPorMoneda } from '@ojoalgasto/shared';

/** Una parte de la barra: lo gastado o lo que falta por cobrar. */
export interface ParteDelGrafico {
  nombre: 'Gastado' | 'Por cobrar';
  /** Ya con formato y moneda: "$25.000". */
  importe: string;
  /** Entero de 0 a 100. Las dos partes suman siempre 100. */
  porcentaje: number;
}

export interface DatosDelGrafico {
  partes: ParteDelGrafico[];
  /** La misma información del gráfico en una frase, para el lector de pantalla. */
  descripcion: string;
}

/**
 * Los datos de la barra de UNA moneda, a partir de las mismas cifras del Panel (AN-01).
 * El gráfico, su leyenda y la descripción para el lector de pantalla salen de aquí, así nunca muestran
 * cifras distintas.
 *
 * Devuelve null si no hay nada que graficar (total en cero, importes negativos o que no son número):
 * en ese caso no se dibuja una barra vacía que parezca un dato, solo queda el texto.
 */
export function datosDelGrafico(gasto: GastoPorMoneda): DatosDelGrafico | null {
  const { gastoReal, gastoProyectado, moneda } = gasto;
  const total = gastoReal + gastoProyectado;
  if (!Number.isFinite(total) || gastoReal < 0 || gastoProyectado < 0 || total <= 0) return null;

  // Se redondea una sola parte y la otra es lo que falta para 100, para que siempre sumen 100.
  const porcentajeGastado = Math.round((gastoReal / total) * 100);
  const partes: ParteDelGrafico[] = [
    { nombre: 'Gastado', importe: formatearMonto(gastoReal, moneda), porcentaje: porcentajeGastado },
    { nombre: 'Por cobrar', importe: formatearMonto(gastoProyectado, moneda), porcentaje: 100 - porcentajeGastado },
  ];
  const detalle = partes.map((parte) => `${parte.nombre.toLowerCase()} ${parte.importe} (${parte.porcentaje}%)`).join(', ');
  return { partes, descripcion: `Gráfico de gasto en ${moneda}: ${detalle}.` };
}
