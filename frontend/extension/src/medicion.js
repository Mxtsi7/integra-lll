// Alarma cada 30 s: un hueco mayor a 45 s se considera cobertura desconocida.
const MAXIMO_HUECO_MS = 45000;
const MAXIMO_SESIONES = 500;
const UMBRAL_INACTIVIDAD_MS = 60000;

export function avanzarMedicion(anterior, observacion) {
  const { observadoEn, sesionId, dominio, estado, suscripcionId = null } = observacion;
  if (!Number.isFinite(observadoEn)) throw new Error('Instante inválido');
  if (anterior?.sesionId !== sesionId) anterior = undefined;
  const sesiones = [...(anterior?.sesiones ?? [])];
  let tramo = anterior?.tramo ?? null;
  if (tramo) {
    const transcurrido = observadoEn - tramo.confirmadoHasta;
    const continuidad = transcurrido >= 0 && transcurrido <= MAXIMO_HUECO_MS;
    if (continuidad && estado === 'activo' && dominio === tramo.dominio && suscripcionId === tramo.suscripcionId) {
      return { ...anterior, tramo: { ...tramo, confirmadoHasta: observadoEn } };
    }
    let fin = continuidad ? observadoEn : tramo.confirmadoHasta;
    if (estado === 'error_de_consulta') fin = tramo.confirmadoHasta;
    if (estado === 'inactivo') fin = Math.min(fin, observadoEn - UMBRAL_INACTIVIDAD_MS);
    if (fin > tramo.inicio && sesiones.length < MAXIMO_SESIONES) {
      sesiones.push({ dominio: tramo.dominio, suscripcionId: tramo.suscripcionId,
        inicio: tramo.inicio, fin, duracionMs: fin - tramo.inicio });
    }
    tramo = null;
  }
  const limiteAlcanzado = sesiones.length >= MAXIMO_SESIONES;
  if (!limiteAlcanzado && estado === 'activo' && dominio) {
    tramo = { dominio, suscripcionId, inicio: observadoEn, confirmadoHasta: observadoEn };
  }
  return { sesionId, sesiones, tramo, limiteAlcanzado };
}

export function resumirMinutos(medicion) {
  const totalesMs = {};
  const sumar = (dominio, duracionMs) => {
    if (duracionMs > 0) totalesMs[dominio] = (totalesMs[dominio] ?? 0) + duracionMs;
  };
  for (const sesion of medicion?.sesiones ?? []) sumar(sesion.dominio, sesion.duracionMs);
  const tramo = medicion?.tramo;
  if (tramo) sumar(tramo.dominio, tramo.confirmadoHasta - tramo.inicio);
  return Object.fromEntries(Object.entries(totalesMs).map(([dominio, ms]) => [dominio, ms / 60000]));
}
