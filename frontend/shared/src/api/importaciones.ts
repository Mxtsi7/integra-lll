import { pedir, type Paginado } from './cliente';

/** Los estados de FE-08. `completada` y `fallida` son terminales: no cambian más. */
export type EstadoImportacion = 'pendiente' | 'procesando' | 'completada' | 'fallida';

/** Un error resumido de una fila (FE-08 guarda los primeros 20; el total va en `errores_totales`). */
export interface ErrorImportacion {
  codigo?: string;
  mensaje: string;
  /** Número de fila del archivo; null si el error no es de una fila. */
  fila?: number | null;
}

/** ImportacionSerializer de FE-08: el progreso de una carga de CSV o de correo. */
export interface Importacion {
  id: string;
  origen: 'csv' | 'correo';
  origen_legible: string;
  nombre_archivo: string;
  estado: EstadoImportacion;
  estado_legible: string;
  /** Si el estado ya es terminal. */
  terminada: boolean;
  /** 0 a 100, o null si todavía no se sabe cuántas filas hay (no es lo mismo que 0). */
  progreso: number | null;
  filas_totales: number | null;
  filas_procesadas: number;
  /** Cobros posibles encontrados. Todavía no se creó ninguna suscripción con ellos. */
  candidatos_detectados: number;
  /** Si la persona ya aceptó los candidatos (FE-11). Distinto de `terminada`. */
  candidatos_confirmados: boolean;
  errores: ErrorImportacion[];
  errores_totales: number;
  terminada_en: string | null;
  confirmada_en: string | null;
  creado_en: string;
}

/** GET /api/importaciones/<id>/. Una de otra organización responde 404, igual que una que no existe. */
export async function getImportacion(id: string): Promise<Importacion> {
  return await pedir(`/importaciones/${encodeURIComponent(id)}/`);
}

/** GET /api/importaciones/?mias=true: las que pidió quien consulta, de a 10 por página. */
export async function getMisImportaciones(pagina = 1): Promise<Paginado<Importacion>> {
  const consulta = new URLSearchParams({ mias: 'true', page: String(pagina) });
  return await pedir(`/importaciones/?${consulta.toString()}`);
}
