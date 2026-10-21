import {
  cambiarContrasena,
  ErrorDeApi,
  erroresCambioContrasenaDesdeServidor,
  MENSAJE_POLITICA_PASSWORD,
  validarCambioContrasena,
  type CampoCambioContrasena,
  type DatosCambioContrasena,
  type ErroresCambioContrasena,
} from '@ojoalgasto/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Boton } from '../ui/Boton';
import { CampoContrasena } from '../ui/Campo';
import { Modal } from '../ui/Modal';
import styles from './Perfil.module.css';

const MENSAJE_SIN_RED = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const MENSAJE_GENERICO = 'No pudimos cambiar la contraseña. Intenta de nuevo.';

const VACIO: DatosCambioContrasena = { actual: '', nueva: '', confirmacion: '' };
// Orden de los campos en pantalla: el foco va al primero que tenga error.
const ORDEN: CampoCambioContrasena[] = ['actual', 'nueva', 'confirmacion'];

interface CambiarContrasenaProps {
  alCerrar: () => void;
  /**
   * El backend confirmó el cambio. Ya invalidó todas las sesiones, también
   * la de este navegador: quien abre el formulario cierra la sesión local.
   */
  onCambiada: () => void;
}

/**
 * Formulario para cambiar la contraseña con la sesión iniciada (CH-29),
 * conectado a POST /api/auth/change-password/ (MX-05).
 *
 * - Valida antes de enviar con la misma política que el registro y el
 *   backend; si la confirmación no coincide, no se envía nada.
 * - Los errores del backend van a su campo (p. ej. "La contraseña actual no
 *   es válida." bajo Contraseña actual). Un error sin campo (sin red, 503)
 *   se muestra arriba de los botones y la sesión no se toca: la contraseña
 *   no cambió y se puede reintentar.
 * - Mientras se envía no se puede cerrar: el resultado decide qué pasa con
 *   la sesión.
 */
export function CambiarContrasena({ alCerrar, onCambiada }: CambiarContrasenaProps) {
  const [datos, setDatos] = useState<DatosCambioContrasena>(VACIO);
  const [errores, setErrores] = useState<ErroresCambioContrasena>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const ids: Record<CampoCambioContrasena, string> = {
    actual: useId(),
    nueva: useId(),
    confirmacion: useId(),
  };

  // Estable: el Modal vuelve a enfocar su primer campo cada vez que cambia
  // `alCerrar`, y con una función nueva en cada render el foco saltaría.
  const cerrarSiSePuede = useCallback(() => {
    if (!enviandoRef.current) alCerrar();
  }, [alCerrar]);

  // Tras un error, el foco va al primer campo marcado.
  const primeroConError = ORDEN.find((campo) => errores[campo]);
  const idPrimeroConError = primeroConError ? ids[primeroConError] : null;
  useEffect(() => {
    if (idPrimeroConError) document.getElementById(idPrimeroConError)?.focus();
  }, [errores, idPrimeroConError]);

  function cambiar(campo: CampoCambioContrasena, valor: string) {
    setDatos((anteriores) => ({ ...anteriores, [campo]: valor }));
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (enviandoRef.current) return;

    const locales = validarCambioContrasena(datos);
    setErrores(locales);
    setErrorGeneral(null);
    if (Object.keys(locales).length > 0) return;

    enviandoRef.current = true;
    setEnviando(true);
    try {
      await cambiarContrasena({
        password_actual: datos.actual,
        password: datos.nueva,
        password_confirmacion: datos.confirmacion,
      });
      onCambiada();
    } catch (err: unknown) {
      if (err instanceof ErrorDeApi && err.campos) {
        const { porCampo, general } = erroresCambioContrasenaDesdeServidor(err.campos);
        setErrores(porCampo);
        setErrorGeneral(general.length > 0 ? general.join(' ') : null);
      } else if (err instanceof TypeError) {
        setErrorGeneral(MENSAJE_SIN_RED);
      } else if (err instanceof ErrorDeApi) {
        setErrorGeneral(err.message || MENSAJE_GENERICO);
      } else {
        setErrorGeneral(MENSAJE_GENERICO);
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Cambiar contraseña"
      descripcion="Al cambiarla se cierra la sesión en todos tus dispositivos, también en este."
      alCerrar={cerrarSiSePuede}
    >
      <form className={styles.formulario} onSubmit={enviar} noValidate>
        <CampoContrasena
          id={ids.actual}
          etiqueta="Contraseña actual"
          value={datos.actual}
          onChange={(e) => cambiar('actual', e.target.value)}
          error={errores.actual}
          autoComplete="current-password"
        />
        <CampoContrasena
          id={ids.nueva}
          etiqueta="Contraseña nueva"
          value={datos.nueva}
          onChange={(e) => cambiar('nueva', e.target.value)}
          error={errores.nueva}
          ayuda={MENSAJE_POLITICA_PASSWORD}
          autoComplete="new-password"
        />
        <CampoContrasena
          id={ids.confirmacion}
          etiqueta="Repite la contraseña nueva"
          value={datos.confirmacion}
          onChange={(e) => cambiar('confirmacion', e.target.value)}
          error={errores.confirmacion}
          autoComplete="new-password"
        />

        {errorGeneral && (
          <p className={styles.error} role="alert">
            {errorGeneral}
          </p>
        )}

        <div className={styles.acciones}>
          <Boton variante="secundario" onClick={cerrarSiSePuede} disabled={enviando}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando}>
            {enviando ? 'Cambiando…' : 'Cambiar contraseña'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}
