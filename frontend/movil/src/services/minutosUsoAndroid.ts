export interface TramoUsoAndroid {
  paquete: string;
  inicioMs: number;
  finMs: number;
}

export interface UsoDiarioAndroid {
  paquete: string;
  fechaLocal: string;
  duracionMs: number;
  minutos: number;
}

function validarTramo({ paquete, inicioMs, finMs }: TramoUsoAndroid): void {
  if (!paquete.trim() || !Number.isSafeInteger(inicioMs) || !Number.isSafeInteger(finMs)
      || inicioMs < 0 || inicioMs >= finMs || finMs > 8_640_000_000_000_000) {
    throw new RangeError('Tramo de uso Android inválido');
  }
}

function agruparPorPaquete(tramos: readonly TramoUsoAndroid[]): Map<string, TramoUsoAndroid[]> {
  const grupos = new Map<string, TramoUsoAndroid[]>();
  for (const tramo of tramos) {
    validarTramo(tramo);
    const grupo = grupos.get(tramo.paquete) ?? [];
    grupo.push(tramo);
    grupos.set(tramo.paquete, grupo);
  }
  return grupos;
}

function* unirTramos(tramos: TramoUsoAndroid[]): Generator<TramoUsoAndroid> {
  let unido: TramoUsoAndroid | undefined;
  for (const tramo of tramos.sort((primero, segundo) => primero.inicioMs - segundo.inicioMs)) {
    if (unido && tramo.inicioMs <= unido.finMs) {
      unido.finMs = Math.max(unido.finMs, tramo.finMs);
      continue;
    }
    if (unido) yield unido;
    unido = { ...tramo };
  }
  if (unido) yield unido;
}

function finDelDia(
  inicioMs: number,
  finMs: number,
  fecha: string,
  fechaDe: (instanteMs: number) => string,
): number {
  if (fechaDe(finMs - 1) === fecha) return finMs;
  let inferior = inicioMs;
  let superior = finMs - 1;
  while (superior - inferior > 1) {
    const medio = inferior + Math.floor((superior - inferior) / 2);
    if (fechaDe(medio) === fecha) inferior = medio;
    else superior = medio;
  }
  return superior;
}

/** Resume únicamente tramos de actividad. Un resultado vacío no acredita cobertura. */
export function calcularMinutosUsoAndroid(
  tramos: readonly TramoUsoAndroid[],
  zonaHoraria: string,
): UsoDiarioAndroid[] {
  if (/^[+-]/.test(zonaHoraria)) throw new RangeError('Se requiere una zona IANA');
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria, calendar: 'iso8601', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const fechaDe = (instanteMs: number): string => {
    const partes = formato.formatToParts(instanteMs);
    const campo = (tipo: 'year' | 'month' | 'day') => partes.find(parte => parte.type === tipo)!.value;
    return `${campo('year')}-${campo('month')}-${campo('day')}`;
  };
  const resumen: UsoDiarioAndroid[] = [];
  for (const [paquete, grupo] of agruparPorPaquete(tramos)) {
    const duraciones = new Map<string, number>();
    for (const tramo of unirTramos(grupo)) {
      let inicioMs = tramo.inicioMs;
      while (inicioMs < tramo.finMs) {
        const fechaLocal = fechaDe(inicioMs);
        const finMs = finDelDia(inicioMs, tramo.finMs, fechaLocal, fechaDe);
        duraciones.set(fechaLocal, (duraciones.get(fechaLocal) ?? 0) + (finMs - inicioMs));
        inicioMs = finMs;
      }
    }
    for (const [fechaLocal, duracionMs] of duraciones) {
      resumen.push({ paquete, fechaLocal, duracionMs, minutos: duracionMs / 60_000 });
    }
  }
  return resumen;
}
