/**
 * Contrato de eventos de uso y cobertura de recolectores v1 (S3-VI-01).
 *
 * Fuente de verdad: docs/contratos/uso-recolectores-v1.md y su esquema
 * docs/contratos/uso-recolectores-v1.schema.json. Este archivo es la
 * versión TypeScript de ese contrato para web, móvil y el cliente Windows
 * (ADR-008); se edita solo junto con el contrato, nunca por separado.
 *
 * Lo consumen el recolector (S3-MX-01) y el cliente de Analytics. Los
 * nombres de campo y los valores de los enums replican el vocabulario
 * oficial del contrato: duracion_ms, tramos_actividad, cobertura, estado,
 * origen, recolector_id, event_id.
 */

/** Resultado de la medición de un día. Manda sobre el resto de los campos. */
export type EstadoUso =
  // Hubo uso medible: duracion_ms > 0 y al menos un tramo.
  | "con_uso"
  // Se midió y no hubo nada: un cero REAL que FE-29 puede afirmar.
  | "cero_observado"
  // Pausa, permiso revocado u offline: sin dato y sin cobertura. No es uso cero.
  | "sin_medicion";

/** Un segmento de actividad, en UTC con sufijo Z. */
export interface TramoActividad {
  /** RFC3339 UTC terminado en Z. */
  inicio: string;
  /** Siempre posterior a `inicio`. */
  fin: string;
}

/** Rango de días (inclusive) que el recolector midió COMPLETO. */
export interface CoberturaDiaria {
  /** YYYY-MM-DD. */
  desde: string;
  /** YYYY-MM-DD. Siempre >= desde. */
  hasta: string;
}

/** POST /api/analitica/ingesta/uso/ — un día de uso de una suscripción. */
export interface UsageEventPayload {
  /** Versión del contrato. Hoy, siempre 1. */
  version: 1;
  /** UUID del hecho: nace una vez y sobrevive a los reintentos (idempotencia). */
  event_id: string;
  /** Instancia que mide, ej. "recolector-windows-8f14". */
  recolector_id: string;
  /** Código del origen registrada: cliente_windows, extension_navegador, api_externa. */
  origen: string;
  /** Tenant. Debe coincidir con la identidad de la sesión (RF-26). */
  organizacion_id: string;
  /** Suscripción existente en la organización; el recolector no la inventa. */
  suscripcion_id: string;
  /** Día local del usuario (America/Santiago) al que pertenece el uso. */
  fecha: string;
  estado: EstadoUso;
  /** Uso total del día en milisegundos: la suma de los tramos. */
  duracion_ms: number;
  /** Segmentos de actividad del día. Vacío si no hubo uso o no se midió. */
  tramos_actividad: TramoActividad[];
  /** Días que se midieron completos, o null si el día quedó incompleto/sin medir. */
  cobertura: CoberturaDiaria | null;
  /** Instante UTC (Z) en que el recolector generó el evento. */
  ocurrido_en: string;
}

/** POST /api/analitica/ingesta/cobertura/ — acredita un rango completo. */
export interface CoverageIntervalPayload {
  version: 1;
  event_id: string;
  recolector_id: string;
  origen: string;
  organizacion_id: string;
  suscripcion_id: string;
  /** Primer día acreditado (inclusive). */
  desde: string;
  /** Último día acreditado (inclusive). Siempre >= desde. */
  hasta: string;
  ocurrido_en: string;
}

/** Cuerpo de las respuestas 201 y 200. */
export interface AcuseUso {
  /** El mismo event_id del payload que se envió. */
  event_id: string;
  estado: EstadoAcuseUso;
  detalle: string;
}

export type EstadoAcuseUso =
  // 201: primera vez que el evento se procesa.
  | "aceptado"
  // 200: ya estaba procesado; se confirma sin repetir el efecto.
  | "duplicado";

/** Cuerpo de las respuestas 400, 403, 404 y 409. */
export interface ErrorUso {
  /** Solo cuando el receptor alcanzó a leerlo del cuerpo. */
  event_id?: string | null;
  codigo: CodigoErrorUso;
  detalle: string;
}

export type CodigoErrorUso =
  // 400: no pasa el esquema o las reglas cruzadas (suma de tramos, rangos).
  | "payload_invalido"
  // 409: mismo event_id con un payload distinto; no se sobrescribe.
  | "conflicto_idempotencia"
  // 404: Analytics no tiene esa suscripción en ese tenant.
  | "suscripcion_desconocida"
  // 403: organizacion_id distinto al de la sesión.
  | "tenant_invalido";

/** Rutas canónicas del contrato (el gateway las enruta a Analytics). */
export const RUTA_INGESTA_USO = "/api/analitica/ingesta/uso/";
export const RUTA_INGESTA_COBERTURA = "/api/analitica/ingesta/cobertura/";
