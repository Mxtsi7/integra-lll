import { ErrorValidacionUso } from './errores';

/**
 * Fechas UTC y día local.
 *
 * El contrato exige instantes UTC con sufijo `Z`, ventana semiabierta
 * `[inicio, fin)` y que cada evento quepa en un único día local. No se suma
 * 24 horas: los cambios de horario se resuelven con la base IANA de `Intl`.
 */

const RE_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

const formateadores = new Map<string, Intl.DateTimeFormat>();

function obtenerFormateador(zonaHoraria: string): Intl.DateTimeFormat {
  const existente = formateadores.get(zonaHoraria);
  if (existente) return existente;

  let formateador: Intl.DateTimeFormat;
  try {
    formateador = new Intl.DateTimeFormat('en-US', {
      timeZone: zonaHoraria,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    throw new ErrorValidacionUso(
      'evento_invalido',
      `zona_horaria no es una zona IANA válida: ${zonaHoraria}`,
    );
  }
  formateadores.set(zonaHoraria, formateador);
  return formateador;
}

/** Valida que la zona exista realmente; una cadena no vacía no basta. */
export function validarZonaHoraria(zonaHoraria: string): void {
  obtenerFormateador(zonaHoraria);
}

/**
 * Parsea un instante UTC estricto. Rechaza fechas imposibles como
 * `2026-02-30` (que `Date` normalizaría en silencio) y horas fuera de rango.
 */
export function parsearUtc(texto: string): Date {
  const partes = RE_UTC.exec(texto);
  if (!partes) {
    throw new ErrorValidacionUso(
      'evento_invalido',
      `instante UTC inválido (se espera YYYY-MM-DDTHH:mm:ss[.SSS]Z): ${texto}`,
    );
  }

  const anio = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);
  const hora = Number(partes[4]);
  const minuto = Number(partes[5]);
  const segundo = Number(partes[6]);
  const fraccion = partes[7] ? Number(partes[7].padEnd(3, '0')) : 0;

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59 || segundo > 59) {
    throw new ErrorValidacionUso('evento_invalido', `instante UTC fuera de rango: ${texto}`);
  }

  const fecha = new Date(Date.UTC(2000, 0, 1));
  fecha.setUTCFullYear(anio, mes - 1, dia);
  fecha.setUTCHours(hora, minuto, segundo, fraccion);

  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== dia ||
    fecha.getUTCHours() !== hora ||
    fecha.getUTCMinutes() !== minuto ||
    fecha.getUTCSeconds() !== segundo ||
    fecha.getUTCMilliseconds() !== fraccion
  ) {
    throw new ErrorValidacionUso('evento_invalido', `fecha UTC inexistente: ${texto}`);
  }

  return fecha;
}

/** Forma canónica estable para almacenar y comparar: siempre milisegundos. */
export function formatearUtc(instante: Date): string {
  return instante.toISOString();
}

/** Día local `YYYY-MM-DD` de un instante en una zona IANA. */
export function fechaLocalDe(instante: Date, zonaHoraria: string): string {
  const formateador = obtenerFormateador(zonaHoraria);
  const partes = formateador.formatToParts(instante);
  const anio = partes.find((parte) => parte.type === 'year')?.value;
  const mes = partes.find((parte) => parte.type === 'month')?.value;
  const dia = partes.find((parte) => parte.type === 'day')?.value;
  if (!anio || !mes || !dia) {
    throw new ErrorValidacionUso(
      'evento_invalido',
      `no se pudo resolver el día local en ${zonaHoraria}`,
    );
  }
  return `${anio}-${mes}-${dia}`;
}

/**
 * Comprueba que `[inicio, fin)` quepa en un solo día local y devuelve ese día.
 *
 * `fin` puede coincidir con la medianoche local siguiente: se mira el último
 * instante incluido (`fin - 1 ms`), no `fin`, porque la ventana es semiabierta.
 */
export function validarDiaLocalUnico(
  inicio: Date,
  fin: Date,
  zonaHoraria: string,
): string {
  validarZonaHoraria(zonaHoraria);
  if (fin.getTime() <= inicio.getTime()) {
    throw new ErrorValidacionUso(
      'detalle_actividad_invalido',
      'la ventana debe cumplir inicio < fin',
    );
  }
  const diaInicio = fechaLocalDe(inicio, zonaHoraria);
  const diaUltimoInstante = fechaLocalDe(new Date(fin.getTime() - 1), zonaHoraria);
  if (diaInicio !== diaUltimoInstante) {
    throw new ErrorValidacionUso(
      'intervalo_cruza_dia_local',
      `la ventana cruza el día local (${diaInicio} -> ${diaUltimoInstante} en ${zonaHoraria}); debe dividirse en eventos con event_id propio`,
    );
  }
  return diaInicio;
}

/** Día local de un `YYYY-MM-DD` ya validado (útil para mensual). */
export function partesDeFechaLocal(fechaLocal: string): {
  anio: number;
  mes: number;
  dia: number;
} {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaLocal);
  if (!partes) {
    throw new RangeError(`fecha local inválida: ${fechaLocal}`);
  }
  return {
    anio: Number(partes[1]),
    mes: Number(partes[2]),
    dia: Number(partes[3]),
  };
}
