import { useRef, useState } from 'react';
import { eliminarCuenta, type DatosEliminacion, type ResultadoEliminacion } from '@ojoalgasto/shared';
import { describirErrorDeEliminacion, PALABRA_CONFIRMACION } from './reglasEliminacion';

export interface OpcionesEliminarCuenta {
  /** Llama al backend. Se reemplaza en las pruebas. */
  onEliminar?: (datos: DatosEliminacion) => Promise<ResultadoEliminacion>;
  /** Se llama solo cuando el backend aceptó. Aquí se cierra la sesión local. */
  onEliminada: (resultado: ResultadoEliminacion) => void;
}

/**
 * Formulario de eliminación de cuenta (AN-19).
 * Regla clave: la sesión local se cierra solo después de que el backend acepta (204 o 202).
 * Cancelar, un error o un cierre de pantalla no tocan la sesión.
 */
export function useEliminarCuenta({ onEliminar = eliminarCuenta, onEliminada }: OpcionesEliminarCuenta) {
  const [contrasena, setContrasena] = useState('');
  const [textoConfirmacion, setTextoConfirmacion] = useState('');
  const [pideOrganizacion, setPideOrganizacion] = useState(false);
  const [organizacionConfirmada, setOrganizacionConfirmada] = useState(false);
  const [estaEnviando, setEstaEnviando] = useState(false);
  const [errorContrasena, setErrorContrasena] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const envioEnCurso = useRef(false); // candado contra doble toque

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

    try {
      const datos: DatosEliminacion = {
        password: contrasena,
        confirmacion: PALABRA_CONFIRMACION,
        ...(pideOrganizacion ? { confirmacion_organizacion: PALABRA_CONFIRMACION } : {}),
      };
      const resultado = await onEliminar(datos);
      onEliminada(resultado);
    } catch (error) {
      const problema = describirErrorDeEliminacion(error);
      if (problema.pideConfirmarOrganizacion) setPideOrganizacion(true);
      if (problema.lugar === 'contrasena') setErrorContrasena(problema.mensaje);
      else setErrorGeneral(problema.mensaje);
    } finally {
      envioEnCurso.current = false;
      setEstaEnviando(false);
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
