import type { CandidatoDetectado, Paginado } from '@ojoalgasto/shared';

/** Un candidato inventado, `propuesto` y con proveedor reconocido. Solo para pruebas: nada de esto viene de un servicio. */
export function candidatoDePrueba(sobrescribir: Partial<CandidatoDetectado> = {}): CandidatoDetectado {
  return {
    id: 'c-1',
    importacion: '6f1c2b8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
    origen: 'csv',
    origen_legible: 'Archivo CSV o cartola',
    identificador_origen: 'sha:3',
    servicio: 'Spotify',
    servicio_texto: 'SPOTIFY *PREMIUM',
    servicio_resultado: 'reconocido',
    importe: '5900.00',
    moneda: 'CLP',
    fecha: '2026-10-28',
    tipo_mensaje: 'cobro_realizado',
    tipo_mensaje_legible: 'Cobro realizado',
    estado: 'propuesto',
    estado_legible: 'Propuesto',
    decidido_en: null,
    decidido_por: '',
    aplicacion: null,
    evidencia: { fila: '3' },
    creado_en: '2026-10-28T22:00:00-03:00',
    ...sobrescribir,
  };
}

/** Una página inventada, con un candidato. */
export function paginaDeCandidatosDePrueba(sobrescribir: Partial<Paginado<CandidatoDetectado>> = {}): Paginado<CandidatoDetectado> {
  return { count: 1, next: null, previous: null, results: [candidatoDePrueba()], ...sobrescribir };
}
