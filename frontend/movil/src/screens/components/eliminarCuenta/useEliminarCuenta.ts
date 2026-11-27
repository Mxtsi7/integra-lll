import { useEffect, useRef, useState } from 'react';
import { eliminarCuenta, type DatosEliminacion, type ResultadoEliminacion } from '@ojoalgasto/shared';
import { describirErrorDeEliminacion, PALABRA_CONFIRMACION } from './reglasEliminacion';

export interface OpcionesEliminarCuenta {
  /** Llama al backend. Se reemplaza en las pruebas. */
  onEliminar?: (datos: DatosEliminacion) => Promise<ResultadoEliminacion>;
  /** Se llama solo cuando el backend aceptó. Aquí se cierra la sesión local. */
  onEliminada: (resultado: ResultadoEliminacion) => void;
  /**
   * Marca de la sesión de este momento (AuthContext.capturarSesion). Se anota al confirmar y se
   * compara al responder: si cambió, la respuesta (o el error) es de otra sesión y no se toca
   * nada. Sin ella (pruebas) se asume la misma sesión.
   */
  capturarSesion?: () => number;
}

const MISMA_SESION = () => 0;

/**
 * Formulario de eliminación de cuenta (AN-19).
 * Regla clave: la sesión local se cierra solo después de que el backend acepta (204 o 202).
 * Cancelar, un error o un cierre de pantalla no tocan la sesión. Una respuesta que llega cuando
 * ya cambió la sesión (otra cuenta entró) tampoco la toca.
 */
export function useEliminarCuenta({
  onEliminar = eliminarCuenta,
  onEliminada,
  capturarSesion = MISMA_SESION,
}: OpcionesEliminarCuenta) {
  const [contrasena, setContrasena] = useState('');
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [pideOrganizacion, setPideOrganizacion] = useState(false);
  const [organizacionConfirmada, setOrganizacionConfirmada] = useState(false);
  const [estaEnviando, setEstaEnviando] = useState(false);
  const [errorContrasena, setErrorContrasena] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const envioEnCurso = useRef(false); // candado contra doble toque
  // Si la pantalla ya se cerró, una respuesta tardía no debe actualizar su estado.
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  const puedeConfirmar =
    contrasena.length > 0 &&
    textoConfirmacion === PALABRA_CONFIRMACION &&
    (!pideOrganizacion || organizacionConfirmada) &&
    !estaEnviando;

  async function confirmar() {
    if (!puedeConfirmar || envioEnCurso.current) return;
    envioEnCurso.current = true;
    setEstaEnviando(true);
    setErrorContrasena(null);
    setErrorGeneral(null);
    // La sesión que pidió el borrado: otra cuenta que entre mientras esperamos no debe verse
    // afectada por esta respuesta (cerrarSesion() cierra la sesión que haya en ese momento).
    const sesion = capturarSesion();
    const sigueLaMismaSesion = () => sesion === capturarSesion();

    try {
      const datos: DatosEliminacion = {
        password: contrasena,
        confirmacion: PALABRA_CONFIRMACION,
        ...(pideOrganizacion ? { confirmacion_organizacion: PALABRA_CONFIRMACION } : {}),
      };
      const resultado = await onEliminar(datos);
      if (!sigueLaMismaSesion()) return;
      onEliminada(resultado);
    } catch (error) {
      // Un error de una sesión anterior (o de una pantalla ya cerrada) no se muestra.
      if (!montado.current || !sigueLaMismaSesion()) return;
      const problema = describirErrorDeEliminacion(error);
      if (problema.pideConfirmarOrganizacion) setPideOrganizacion(true);
      if (problema.lugar === 'contrasena') setErrorContrasena(problema.mensaje);
      else setErrorGeneral(problema.mensaje);
    } finally {
      envioEnCurso.current = false;
      if (montado.current) setEstaEnviando(false);
    }
  }

  return {
    contrasena,
    setContrasena,
    textoConfirmacion,
    setTextoConfirmacion,
    pideOrganizacion,
    organizacionConfirmada,
    alternarOrganizacion: () => setOrganizacionConfirmada((confirmada) => !confirmada),
    estaEnviando,
    errorContrasena,
    errorGeneral,
    puedeConfirmar,
    confirmar,
  };
}
