import type { Suscripcion } from '@ojoalgasto/shared';

const COLUMNAS = ['nombre', 'monto', 'moneda', 'frecuencia', 'fecha_proximo_cobro', 'categoria', 'estado'] as const;

/**
 * Convierte el arreglo de suscripciones a un blob CSV. Separada de la
 * función que dispara la descarga para poder testearla sin tocar el DOM
 * (tarea: "Test renderizado de gráfico de gastos" aplica el mismo criterio
 * acá: la lógica pura se testea aparte de la interacción con el navegador).
 */
export function suscripcionesACsvBlob(suscripciones: Suscripcion[]): Blob {
  const encabezado = COLUMNAS.join(',');
  const filas = suscripciones.map((s) =>
    COLUMNAS.map((columna) => escaparCeldaCsv(String(s[columna] ?? ''))).join(','),
  );
  const contenido = [encabezado, ...filas].join('\n');
  return new Blob([contenido], { type: 'text/csv;charset=utf-8;' });
}

function escaparCeldaCsv(valor: string): string {
  if (valor.includes(',') || valor.includes('"') || valor.includes('\n')) {
    return `"${valor.replace(/"/g, '""')}"`;
  }
  return valor;
}

/** Dispara la descarga del CSV en el navegador. Usa suscripcionesACsvBlob() por dentro. */
export function descargarSuscripcionesCsv(suscripciones: Suscripcion[], nombreArchivo = 'suscripciones.csv'): void {
  const blob = suscripcionesACsvBlob(suscripciones);
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
  URL.revokeObjectURL(url);
}
