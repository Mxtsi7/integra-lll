/**
 * Unión temporal de intervalos semiabiertos `[inicio, fin)`.
 *
 * Es la operación que exige el contrato para simultaneidad: Android y
 * navegador observando los mismos dos minutos acreditan dos minutos, no
 * cuatro. Se conservan milisegundos exactos.
 */

export interface IntervaloMs {
  readonly inicio: number;
  readonly fin: number;
}

/**
 * Devuelve la unión ordenada de los intervalos con duración positiva.
 *
 * Los intervalos que se tocan (`actual.inicio === ultimo.fin`) se fusionan:
 * para una medida de duración, `[0, 30)` y `[30, 60)` son el mismo bloque de
 * 60 s. Los intervalos contenidos y los solapamientos se recortan.
 */
export function unirIntervalos(intervalos: readonly IntervaloMs[]): IntervaloMs[] {
  const ordenados = intervalos
    .filter((intervalo) => intervalo.fin > intervalo.inicio)
    .map((intervalo) => ({ inicio: intervalo.inicio, fin: intervalo.fin }))
    .sort((a, b) => a.inicio - b.inicio || a.fin - b.fin);

  const unidos: IntervaloMs[] = [];
  for (const actual of ordenados) {
    const ultimo = unidos[unidos.length - 1];
    if (ultimo && actual.inicio <= ultimo.fin) {
      if (actual.fin > ultimo.fin) {
        unidos[unidos.length - 1] = { inicio: ultimo.inicio, fin: actual.fin };
      }
      continue;
    }
    unidos.push(actual);
  }
  return unidos;
}

/** Duración exacta, en milisegundos, de la unión de los intervalos. */
export function duracionUnionMs(intervalos: readonly IntervaloMs[]): number {
  return unirIntervalos(intervalos).reduce(
    (total, intervalo) => total + (intervalo.fin - intervalo.inicio),
    0,
  );
}

/**
 * Huecos internos de la unión dentro de una ventana.
 *
 * Se usa para cobertura: el mínimo inicio y el máximo fin no rellenan un
 * hueco. La ventana es semiabierta y se devuelven solo los huecos positivos.
 */
export function huecosEnVentana(
  intervalos: readonly IntervaloMs[],
  ventana: IntervaloMs,
): IntervaloMs[] {
  if (ventana.fin <= ventana.inicio) return [];
  const unidos = unirIntervalos(
    intervalos
      .map((intervalo) => ({
        inicio: Math.max(intervalo.inicio, ventana.inicio),
        fin: Math.min(intervalo.fin, ventana.fin),
      }))
      .filter((intervalo) => intervalo.fin > intervalo.inicio),
  );

  const huecos: IntervaloMs[] = [];
  let cursor = ventana.inicio;
  for (const intervalo of unidos) {
    if (intervalo.inicio > cursor) {
      huecos.push({ inicio: cursor, fin: intervalo.inicio });
    }
    if (intervalo.fin > cursor) cursor = intervalo.fin;
  }
  if (cursor < ventana.fin) {
    huecos.push({ inicio: cursor, fin: ventana.fin });
  }
  return huecos;
}
