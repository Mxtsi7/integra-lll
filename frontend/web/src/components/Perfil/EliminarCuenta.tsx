import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { AuthError, eliminarCuenta, type DatosEliminacion, type ResultadoEliminacion } from '@ojoalgasto/shared';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Boton } from '../ui/Boton';
import { CampoContrasena, CampoTexto } from '../ui/Campo';
import { Modal } from '../ui/Modal';
import styles from './EliminarCuenta.module.css';
import { createPortal } from 'react-dom';

const PALABRA = 'ELIMINAR' as const;

const MENSAJE_ELIMINADA =
  'Tu cuenta fue eliminada. Tus datos personales se borrarán por completo en un máximo de 72 horas.';
const MENSAJE_PENDIENTE =
  'Cerramos tu sesión y estamos eliminando tu organización. Este proceso puede tardar y todavía no termina.';

export interface EliminarCuentaProps {
  /** Clase del botón que abre el diálogo (las páginas le pasan su estilo "peligro"). */
  className?: string;
  /** Por defecto eliminarCuenta() de shared → DELETE /api/usuarios/me/ (MX-07). Se inyecta en las pruebas. */
  onEliminar?: (datos: DatosEliminacion) => Promise<ResultadoEliminacion>;
}

/**
 * Botón "Eliminar" + diálogo de confirmación: explica los efectos, pide la contraseña actual y
 * que se escriba ELIMINAR. Cancelar no llama a nada ni toca la sesión. La sesión local solo se
 * limpia después de que el backend acepta (204 o 202); nunca antes ni si falla.
 */
export function EliminarCuenta({ className = '', onEliminar = eliminarCuenta }: EliminarCuentaProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const { cerrarSesionLocal } = useAuth();

  const [abierto, setAbierto] = useState(false);
  const [password, setPassword] = useState('');
  const [texto, setTexto] = useState('');
  const [requiereOrg, setRequiereOrg] = useState(false);
  const [orgConfirmada, setOrgConfirmada] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [errorPassword, setErrorPassword] = useState<string | null>(null);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Modal vuelve a enfocar el primer campo si alCerrar cambia; por eso es estable y el estado
  // "enviando" se lee desde una ref.
  const enviandoRef = useRef(false);

  const cerrar = useCallback(() => {
    if (enviandoRef.current) return;
    setAbierto(false);
    setPassword('');
    setTexto('');
    setRequiereOrg(false);
    setOrgConfirmada(false);
    setErrorPassword(null);
    setErrorGeneral(null);
  }, []);

  const puedeConfirmar =
    password.length > 0 && texto === PALABRA && (!requiereOrg || orgConfirmada) && !enviando;

  async function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!puedeConfirmar || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorPassword(null);
    setErrorGeneral(null);
    try {
      const datos: DatosEliminacion = {
        password,
        confirmacion: PALABRA,
        ...(requiereOrg ? { confirmacion_organizacion: PALABRA } : {}),
      };
      const resultado = await onEliminar(datos);
      // El backend ya revocó las sesiones: se borra la local sin volver a llamarlo.
      cerrarSesionLocal();
      toast.exito(resultado.estado === 'pendiente' ? MENSAJE_PENDIENTE : MENSAJE_ELIMINADA);
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      // Ningún error cierra la sesión ni da la cuenta por eliminada.
      if (err instanceof AuthError && err.status === 409) {
        setRequiereOrg(true);
        setErrorGeneral(
          'Eres la última persona titular de tu organización. Para continuar, confirma que también se eliminará la organización.',
        );
      } else if (err instanceof AuthError && err.status === 403) {
        setErrorPassword('No pudimos confirmar tu identidad. Revisa tu contraseña.');
      } else if (err instanceof AuthError && err.status === 400) {
        setErrorGeneral('Revisa los datos e inténtalo de nuevo.');
      } else if (err instanceof AuthError && err.status === 503) {
        setErrorGeneral('No pudimos completar la eliminación. Tu cuenta sigue activa; inténtalo de nuevo en unos minutos.');
      } else if (err instanceof TypeError) {
        setErrorGeneral('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
      } else {
        setErrorGeneral('No pudimos eliminar tu cuenta. Inténtalo de nuevo.');
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <>
      <Boton variante="sutil" tamano="s" className={className} onClick={() => setAbierto(true)}>
        Eliminar
      </Boton>

    {abierto &&
        createPortal(
        <Modal
          titulo="¿Eliminar tu cuenta?"
          descripcion="Esta acción es permanente y no se puede deshacer."
          alCerrar={cerrar}
          tipo="alerta"
          ancho="medio"

        >
          <form className={styles.formulario} onSubmit={confirmar} noValidate>
            <div className={styles.efectos}>
              <p className={styles.intro}>Antes de confirmar, esto es lo que va a pasar:</p>
              <ul className={styles.lista}>
                <li>Tu sesión se cierra de inmediato.</li>
                <li>
                  Tu perfil, tus suscripciones, cobros, registros de uso y cuentas conectadas se eliminan
                  definitivamente en un máximo de 72 horas.
                </li>
                <li>
                  Se conservan separados de tu identidad, por un plazo limitado: el registro de tu consentimiento,
                  los comprobantes de pago del plan Premium (si los hubo) y los registros de auditoría anonimizados.
                </li>
              </ul>
            </div>

            <CampoContrasena
              id="eliminar-password"
              etiqueta="Tu contraseña actual"
              autoComplete="current-password"
              icono={<Lock size={16} />}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setErrorPassword(null);
              }}
              error={errorPassword ?? undefined}
              disabled={enviando}
            />

            <CampoTexto
              id="eliminar-confirmacion"
              etiqueta={`Escribe ${PALABRA} para confirmar`}
              autoComplete="off"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              disabled={enviando}
            />

            {requiereOrg && (
              <label className={styles.organizacion}>
                <input
                  type="checkbox"
                  checked={orgConfirmada}
                  onChange={(e) => setOrgConfirmada(e.target.checked)}
                  disabled={enviando}
                />
                <span>Entiendo que también se eliminará mi organización y todos sus datos.</span>
              </label>
            )}

            {errorGeneral && (
              <p className={styles.error} role="alert">
                {errorGeneral}
              </p>
            )}

            <div className={styles.acciones}>
              <Boton variante="secundario" onClick={cerrar} disabled={enviando}>
                Cancelar
              </Boton>
              <Boton type="submit" variante="peligro" cargando={enviando} disabled={!puedeConfirmar}>
                Eliminar mi cuenta
              </Boton>
            </div>
          </form>
         </Modal>,
         document.body,
       )}
     </>
  );
}

export default EliminarCuenta;
