/**
 * Un mensaje de la conversación que se ve en pantalla. El historial vive solo
 * en la vista (S3-CH-14): al salir de la página o recargarla se pierde, y el
 * backend no lo recibe: cada pregunta se responde sola.
 */
export type MensajeChat =
  | { id: number; autor: 'persona'; texto: string }
  | {
      id: number;
      autor: 'asistente';
      texto: string;
      /** true si el asistente con IA no contestó y el texto es el resumen que calcula el backend. */
      esRespaldo: boolean;
    };
