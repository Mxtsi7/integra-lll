/**
 * S3-CH-17: qué se le dice a la persona cuando el asistente con IA no contestó y
 * lo que ve es el resumen que calcula el backend (`estado: 'degradado'`).
 *
 * Los motivos son los que manda POST /api/asistente/ (analytics, politica_ia.py).
 * La API puede sumar otros: un motivo que la web no conoce, o que no llega, cae en
 * el aviso general en lugar de romper la pantalla o quedarse sin explicación.
 */

export interface TextoDeRespaldo {
  /** Por qué el asistente con IA no contestó. */
  causa: string;
  /** Qué puede hacer la persona ahora. */
  recuperacion: string;
}

/**
 * Lo primero que se dice siempre: lo que se muestra no es la respuesta de la IA.
 * No dice "con tus datos": cuando todavía no hay datos el resumen lo cuenta, y el
 * aviso lo contradiría.
 */
export const ENCABEZADO_DE_RESPALDO = 'Resumen automático.';

const PUEDE_VOLVER_A_PREGUNTAR = 'Puedes volver a preguntar.';
const VOLVER_A_PREGUNTAR_EN_UNOS_MINUTOS = 'Vuelve a preguntar en unos minutos.';
// Para los motivos que no se arreglan preguntando otra vez: se dice qué va a recibir.
const SEGUIRA_EL_RESUMEN_POR_AHORA = 'Por ahora recibirás este resumen automático.';

/** Sin motivo conocido: se dice lo mínimo que es cierto en todos los casos. */
export const TEXTO_DE_RESPALDO_GENERAL: TextoDeRespaldo = {
  causa: 'El asistente con IA no estuvo disponible.',
  recuperacion: PUEDE_VOLVER_A_PREGUNTAR,
};

// Un Map y no un objeto: un motivo como "constructor" no debe encontrar nada.
const TEXTO_DE_RESPALDO_POR_MOTIVO = new Map<string, TextoDeRespaldo>([
  [
    // Falta la configuración del proveedor en el servidor: la persona no puede arreglarlo.
    'no_configurado',
    { causa: 'El asistente con IA no está activado en este momento.', recuperacion: SEGUIRA_EL_RESUMEN_POR_AHORA },
  ],
  ['timeout', { causa: 'El asistente con IA tardó demasiado en responder.', recuperacion: PUEDE_VOLVER_A_PREGUNTAR }],
  [
    'proveedor_no_disponible',
    { causa: 'El asistente con IA no está disponible ahora.', recuperacion: VOLVER_A_PREGUNTAR_EN_UNOS_MINUTOS },
  ],
  [
    // La cuota es por persona y por mes calendario (politica_ia.py, consumir_llamada):
    // se renueva sola al cambiar el mes y volver a preguntar antes no sirve.
    'cuota_agotada',
    {
      causa: 'Ya usaste tus consultas con IA de este mes.',
      recuperacion: 'Hasta el próximo mes recibirás este resumen automático.',
    },
  ],
  [
    'cuota_no_disponible',
    { causa: 'No pudimos comprobar tu cuota de consultas con IA.', recuperacion: VOLVER_A_PREGUNTAR_EN_UNOS_MINUTOS },
  ],
  [
    'capacidad',
    { causa: 'El asistente con IA está atendiendo muchas consultas.', recuperacion: VOLVER_A_PREGUNTAR_EN_UNOS_MINUTOS },
  ],
  [
    'respuesta_invalida',
    { causa: 'El asistente con IA devolvió una respuesta que no se pudo usar.', recuperacion: PUEDE_VOLVER_A_PREGUNTAR },
  ],
]);

/** Los motivos con texto propio. Las pruebas comprueban que cubren los que manda el backend. */
export const MOTIVOS_DE_RESPALDO_CONOCIDOS: readonly string[] = [...TEXTO_DE_RESPALDO_POR_MOTIVO.keys()];

/** El texto para un motivo de respaldo; null o un motivo desconocido dan el texto general. */
export function textoDeRespaldo(motivo: string | null): TextoDeRespaldo {
  if (motivo === null) return TEXTO_DE_RESPALDO_GENERAL;
  return TEXTO_DE_RESPALDO_POR_MOTIVO.get(motivo) ?? TEXTO_DE_RESPALDO_GENERAL;
}
