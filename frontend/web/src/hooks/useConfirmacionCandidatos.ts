import { useCallback, useEffect, useRef, useState } from 'react';
import { codigoDeConfirmacionRechazada, confirmarCandidato, type CandidatoDetectado } from '@ojoalgasto/shared';
import {
  mensajeDeFalloAlConfirmar,
  type ResultadoConfirmacion,
  type ResultadoPorCandidato,
} from '../components/candidatos/confirmacionCandidatos';
import { useAuth } from '../context/AuthContext';

interface OpcionesDeConfirmacion {
  /** Se llama una vez cuando termina una tanda, para que quien llama recargue la lista. */
  alTerminar?: () => void;
}

/** El nombre con que se le muestra el cobro a la persona: el proveedor, o el texto original del banco. */
function nombreDelCobro(candidato: CandidatoDetectado): string {
  return candidato.servicio ?? (candidato.servicio_texto || 'Cobro sin descripción');
}

async function confirmarUno(candidato: CandidatoDetectado): Promise<ResultadoPorCandidato> {
  const nombre = nombreDelCobro(candidato);
  try {
    await confirmarCandidato(candidato.id);
    return { id: candidato.id, nombre, tipo: 'confirmado' };
  } catch (error: unknown) {
    return { id: candidato.id, nombre, tipo: 'fallido', mensaje: mensajeDeFalloAlConfirmar(error, codigoDeConfirmacionRechazada(error)) };
  }
}

/**
 * S3-CH-08: confirma los cobros que eligió la persona, uno por uno contra la API (POST /api/candidatos/<id>/confirmar/).
 *
 * - Un cobro cuenta como confirmado solo si el servidor respondió 200: nada se marca antes.
 * - Un fallo de uno no frena a los demás, y el resultado dice qué pasó con cada cobro.
 * - Una tanda a la vez: un segundo envío mientras la primera sigue no manda nada. El servidor además es
 *   idempotente, así que repetir una confirmación no agrega otra orden.
 * - Si la sesión cambió, el resultado de la anterior no se muestra ni se avisa.
 */
export function useConfirmacionCandidatos({ alTerminar }: OpcionesDeConfirmacion = {}) {
  const { capturarSesion } = useAuth();
  const [sesion] = useState(capturarSesion);
  const montado = useRef(false);
  const hayTandaEnCurso = useRef(false);
  // El último valor de la función, sin volver a crear `confirmar` cada vez que quien llama la redefine.
  const alTerminarActual = useRef(alTerminar);

  const [enCurso, setEnCurso] = useState(false);
  const [resultado, setResultado] = useState<ResultadoConfirmacion | null>(null);

  useEffect(() => {
    alTerminarActual.current = alTerminar;
  });

  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const confirmar = useCallback(
    async (candidatos: readonly CandidatoDetectado[]) => {
      const sigueVigente = () => montado.current && capturarSesion() === sesion;
      if (candidatos.length === 0 || hayTandaEnCurso.current || !sigueVigente()) return;
      hayTandaEnCurso.current = true;
      setEnCurso(true);
      setResultado(null);
      try {
        const resultados = await Promise.all(candidatos.map(confirmarUno));
        if (!sigueVigente()) return;
        setResultado({ resultados });
        alTerminarActual.current?.();
      } finally {
        hayTandaEnCurso.current = false;
        if (montado.current) setEnCurso(false);
      }
    },
    [capturarSesion, sesion],
  );

  const cerrarResultado = useCallback(() => setResultado(null), []);

  return { enCurso, resultado, confirmar, cerrarResultado };
}
