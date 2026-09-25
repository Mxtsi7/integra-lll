/**
 * Días de diferencia entre hoy y una fecha ISO (solo fecha, sin hora).
 * No va en shared/ porque es un umbral de presentación del Dashboard
 * (7 días), no una regla de negocio compartida con móvil.
 */
export function diasHasta(fechaIso: string): number {
  const [anio, mes, dia] = fechaIso.split('-').map(Number);
  const fecha = new Date(anio, mes - 1, dia);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const msPorDia = 1000 * 60 * 60 * 24;
  return Math.round((fecha.getTime() - hoy.getTime()) / msPorDia);
}
