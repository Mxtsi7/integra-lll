import { useCallback, useEffect, useRef, useState } from 'react';
import {
  codigoDeConfirmacionRechazada,
  codigoDeRechazoNoPermitido,
  confirmarCandidato,
  rechazarCandidato,
  type CandidatoDetectado,
} from '@ojoalgasto/shared';
import {
  mensajeDeFalloAlConfirmar,
  mensajeDeFalloAlRechazar,
  type AccionDeCandidato,
  type ResultadoDecisiones,
  type ResultadoPorCandidato,
} from '../components/candidatos/decisionesCandidatos';
import { useAuth } from '../context/AuthContext';

interface OpcionesDeDecisiones {
  /** Se llama una vez cuando termina una tanda, para que quien llama recargue la lista. */
  alTerminar?: () => void;
}

/** El nombre con que se le muestra el cobro a la persona: el proveedor, o el texto original del banco. */
function nombreDelCobro(candidato: CandidatoDetectado): string {
  return candidato.servicio ?? (candidato.servicio_texto || 'Cobro sin descripción');
}

/** Pide una decisión por un cobro y convierte la respuesta, o el fallo, en su resultado. */
async function decidirUno(
  candidato: CandidatoDetectado,
  pedirDecision: () => Promise<unknown>,
  mensajeDeFallo: (error: unknown) => string,
): Promise<ResultadoPorCandidato> {
  const nombre = nombreDelCobro(candidato);
  try {
    await pedirDecision();
    return { id: candidato.id, nombre, tipo: 'hecho' };
  } catch (error: unknown) {
    return { id: candidato.id, nombre, tipo: 'fallido', mensaje: mensajeDeFallo(error) };
  }
}

/** Qué llama cada decisión y qué dice cuando falla. Una sola tanda para las dos: la misma regla de envío y de sesión. */
const DECISIONES: Record<AccionDeCandidato, (candidato: CandidatoDetectado) => Promise<ResultadoPorCandidato>> = {
  confirmar: (candidato) =>
    decidirUno(
      candidato,
      () => confirmarCandidato(candidato.id),
      (error) => mensajeDeFalloAlConfirmar(error, codigoDeConfirmacionRechazada(error)),
    ),
  rechazar: (candidato) =>
    decidirUno(
      candidato,
      () => rechazarCandidato(candidato.id),
      (error) => mensajeDeFalloAlRechazar(error, codigoDeRechazoNoPermitido(error)),
    ),
};

/**
 * S3-CH-08 y S3-CH-09: confirma o rechaza los cobros que eligió la persona, uno por uno contra la API.
 *
 * - Un cobro cuenta como hecho solo si el servidor respondió 200: nada se marca antes.
 * - Un fallo de uno no frena a los demás, y el resultado dice qué pasó con cada cobro.
 * - Una tanda a la vez, de cualquiera de las dos acciones: un segundo envío mientras corre no manda nada.
 *   El servidor además es idempotente, así que repetir una decisión no crea otro efecto.
 * - Si la sesión cambió, el resultado de la anterior no se muestra ni se avisa.
 */
export function useDecisionesDeCandidatos({ alTerminar }: OpcionesDeDecisiones = {}) {
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);
  const montado = useRef(false);
  const hayTandaEnCurso = useRef(false);
  // El último valor de la función, sin volver a crear las decisiones cada vez que quien llama la redefine.
  const alTerminarActual = useRef(alTerminar);

  const [accionEnCurso, setAccionEnCurso] = useState<AccionDeCandidato | null>(null);
  const [resultado, setResultado] = useState<ResultadoDecisiones | null>(null);

  useEffect(() => {
    alTerminarActual.current = alTerminar;
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const decidir = useCallback(
    async (accion: AccionDeCandidato, candidatos: readonly CandidatoDetectado[]) => {
      const sigueVigente = () => montado.current && capturarSesion() === sesion;
      if (candidatos.length === 0 || hayTandaEnCurso.current || !sigueVigente()) return;
      hayTandaEnCurso.current = true;
      setAccionEnCurso(accion);
      setResultado(null);
      try {
        const resultados = await Promise.all(candidatos.map(DECISIONES[accion]));
        if (!sigueVigente()) return;
        setResultado({ accion, resultados });
        alTerminarActual.current?.();
      } finally {
        hayTandaEnCurso.current = false;
        if (montado.current) setAccionEnCurso(null);
      }
    },
    [capturarSesion, sesion],
  );

  const confirmar = useCallback((candidatos: readonly CandidatoDetectado[]) => decidir('confirmar', candidatos), [decidir]);
  const rechazar = useCallback((candidatos: readonly CandidatoDetectado[]) => decidir('rechazar', candidatos), [decidir]);

  const cerrarResultado = useCallback(() => setResultado(null), []);

  return { accionEnCurso, resultado, confirmar, rechazar, cerrarResultado };
}
