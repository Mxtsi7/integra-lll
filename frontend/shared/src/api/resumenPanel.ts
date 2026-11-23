import type { Moneda } from '../tipos';
import { conMayuscula, formatearMesAnio, formatearMonto } from '../formato';
import { esMesValido } from './calendario';
import { getCatalogosSuscripciones } from './catalogos';
import { pedir } from './cliente';

// VI-06: resumen agregado del panel. El backend responde UNA moneda por consulta
// (GET /api/suscripciones/resumen/?mes=YYYY-MM&moneda=CLP), así que para mostrar el periodo
// completo se pide una vez por cada moneda del catálogo. Los importes de monedas distintas
// nunca se suman entre sí.

/** Cuántas suscripciones hay en cada estado. No depende de la moneda. */
export interface ConteoEstados {
  activo: number;
  prueba: number;
  por_confirmar: number;
  cancelado: number;
  fantasma: number;
  total: number;
}

/** Lo gastado y lo que falta por cobrar en UNA moneda. */
export interface GastoPorMoneda {
  moneda: Moneda;
  gastoReal: number;
  gastoProyectado: number;
  totalEstimado: number;
}

export interface ResumenDelPeriodo {
  /** "YYYY-MM". */
  periodo: string;
  conteo: ConteoEstados;
  /** Una fila por moneda del catálogo, tenga o no movimiento. */
  gastos: GastoPorMoneda[];
}

const CLAVES_DEL_CONTEO = ['activo', 'prueba', 'por_confirmar', 'cancelado', 'fantasma', 'total'] as const;

/** Nombre de cada estado para mostrar. Un estado nuevo del backend no entra al resumen hasta agregarlo aquí. */
export const NOMBRE_DE_ESTADO: Record<Exclude<keyof ConteoEstados, 'total'>, string> = {
  activo: 'Activas',
  prueba: 'En prueba',
  por_confirmar: 'Por confirmar',
  cancelado: 'Canceladas',
  fantasma: 'Fantasma',
};

/** Los importes llegan como texto ("25000.00"). Si no son un número, es un error: nunca un NaN en pantalla. */
function leerImporte(valor: unknown, campo: string): number {
  const numero = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : Number.NaN;
  if (valor === '' || !Number.isFinite(numero)) throw new RangeError(`El resumen trae un "${campo}" que no es un número.`);
  return numero;
}

function leerConteo(valor: unknown): ConteoEstados {
  if (typeof valor !== 'object' || valor === null) throw new RangeError('El resumen no trae el conteo por estado.');
  const crudo = valor as Record<string, unknown>;
  const conteo = {} as ConteoEstados;
  for (const clave of CLAVES_DEL_CONTEO) {
    const cantidad = crudo[clave];
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad < 0) {
      throw new RangeError(`El conteo "${clave}" del resumen no es válido.`);
    }
    conteo[clave] = cantidad;
  }
  return conteo;
}

/** Comprueba que la respuesta sea del periodo y la moneda pedidos antes de usarla. */
function leerResumenDeMoneda(crudo: unknown, mes: string, moneda: Moneda) {
  if (typeof crudo !== 'object' || crudo === null) throw new RangeError('La respuesta del resumen no es válida.');
  const datos = crudo as Record<string, unknown>;
  if (datos.periodo !== mes || datos.moneda !== moneda) {
    throw new RangeError('El resumen no corresponde al periodo o la moneda pedidos.');
  }
  return {
    conteo: leerConteo(datos.conteo_estados),
    gasto: {
      moneda,
      gastoReal: leerImporte(datos.gasto_real, 'gasto_real'),
      gastoProyectado: leerImporte(datos.gasto_proyectado, 'gasto_proyectado'),
      totalEstimado: leerImporte(datos.total_estimado, 'total_estimado'),
    },
  };
}

/**
 * El resumen completo de un mes: gasto real, proyección y conteo por estado.
 *
 * Si falla la consulta de CUALQUIER moneda se falla entera: mostrar solo las monedas que sí llegaron
 * dejaría el resumen incompleto sin avisar.
 */
export async function getResumenDelPeriodo(mes: string): Promise<ResumenDelPeriodo> {
  if (!esMesValido(mes)) throw new RangeError(`Mes inválido: "${mes}". Debe ser YYYY-MM.`);

  const catalogos = await getCatalogosSuscripciones();
  const monedas = catalogos.monedas.filter((moneda) => moneda.activo).map((moneda) => moneda.codigo);
  if (monedas.length === 0) throw new RangeError('El catálogo no trae monedas activas.');

  const respuestas = await Promise.all(
    monedas.map(async (moneda) => {
      const crudo = await pedir<unknown>(`/suscripciones/resumen/?mes=${mes}&moneda=${encodeURIComponent(moneda)}`);
      return leerResumenDeMoneda(crudo, mes, moneda);
    }),
  );

  return { periodo: mes, conteo: respuestas[0].conteo, gastos: respuestas.map((respuesta) => respuesta.gasto) };
}

/** Las monedas con algo que mostrar. Una moneda en cero se omite en vez de listar "$0" por cada una. */
export function gastosConMovimiento(resumen: ResumenDelPeriodo): GastoPorMoneda[] {
  return resumen.gastos.filter((gasto) => gasto.gastoReal > 0 || gasto.gastoProyectado > 0);
}

/** "2026-11" + 1 → "2026-12"; "2026-01" − 1 → "2025-12". */
export function desplazarMes(mes: string, cantidad: number): string {
  const [anio, numero] = mes.split('-').map(Number);
  const total = anio * 12 + (numero - 1) + cantidad;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** "2026-11" → "Noviembre de 2026". */
export function etiquetaDelPeriodo(mes: string): string {
  const [anio, numero] = mes.split('-').map(Number);
  return conMayuscula(formatearMesAnio(anio, numero - 1));
}

/**
 * El resumen en una frase, para el lector de pantalla y para compartirlo (AN-26).
 * Cada importe lleva su moneda y el periodo va al principio.
 */
export function textoDelResumen(resumen: ResumenDelPeriodo): string {
  const periodo = etiquetaDelPeriodo(resumen.periodo);
  const conMovimiento = gastosConMovimiento(resumen);
  const gastos =
    conMovimiento.length === 0
      ? 'Sin gastos registrados ni proyectados.'
      : conMovimiento
          .map(
            ({ moneda, gastoReal, gastoProyectado, totalEstimado }) =>
              `En ${moneda}: gastado ${formatearMonto(gastoReal, moneda)}, por cobrar ${formatearMonto(gastoProyectado, moneda)}, total estimado ${formatearMonto(totalEstimado, moneda)}.`,
          )
          .join(' ');
  const estados = (Object.keys(NOMBRE_DE_ESTADO) as (keyof typeof NOMBRE_DE_ESTADO)[])
    .map((estado) => `${resumen.conteo[estado]} ${NOMBRE_DE_ESTADO[estado].toLowerCase()}`)
    .join(', ');
  return `Resumen de ${periodo}. ${gastos} Suscripciones: ${resumen.conteo.total} en total (${estados}).`;
}
