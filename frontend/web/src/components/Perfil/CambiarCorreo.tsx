import { AuthError, solicitarCambioCorreo, validarCorreo } from '@ojoalgasto/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useAuth } from '../../context/AuthContext';
import { Boton } from '../ui/Boton';
import { CampoContrasena, CampoTexto } from '../ui/Campo';
import { Modal } from '../ui/Modal';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import styles from './Perfil.module.css';

const MENSAJE_GENERICO = 'No pudimos pedir el cambio de correo. Intenta de nuevo.';
const MENSAJE_LIMITE = 'Pediste demasiados enlaces. Espera un minuto antes de intentar de nuevo (máximo 5 por hora).';
const MENSAJE_SESION = 'Tu sesión expiró. Inicia sesión e inténtalo de nuevo.';

interface CambiarCorreoProps {
  /** El correo que está activo hoy. No cambia hasta que se confirme el enlace. */
  correoActual: string;
  alCerrar: () => void;
  /** Se inyecta en las pruebas; en la app es la llamada real al backend. */
  onSolicitar?: typeof solicitarCambioCorreo;
}

interface Errores {
  correo?: string;
  password?: string;
}

/**
 * Cambiar el correo desde Perfil (S3-AN-02).
 *
 * Pide el correo nuevo y la contraseña actual. El backend manda un enlace al
 * correo NUEVO y el actual sigue activo hasta que ese enlace se confirma
 * (VerificarCorreoPage). Por eso, tras pedirlo, lo único que cambia en pantalla
 * es este aviso: el correo que muestra Perfil no se toca.
 *
 * - Contraseña incorrecta va bajo su campo; correo ocupado, bajo el correo.
 * - El límite de envíos y los fallos sin campo salen arriba de los botones.
 * - Si mientras se enviaba se cerró la sesión o entró otra cuenta, no se
 *   muestra ningún aviso: la respuesta no es de esta sesión.
 */
export function CambiarCorreo({ correoActual, alCerrar, onSolicitar = solicitarCambioCorreo }: CambiarCorreoProps) {
  const { capturarSesion } = useAuth();
  const [correo, setCorreo] = useState('');
  const [password, setPassword] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviadoA, setEnviadoA] = useState<string | null>(null);
  const enviandoRef = useRef(false);
  const idCorreo = useId();
  const idPassword = useId();

  // Estable: el Modal vuelve a enfocar su primer campo si cambia `alCerrar`.
  const cerrarSiSePuede = useCallback(() => {
    if (!enviandoRef.current) alCerrar();
  }, [alCerrar]);

  const primeroConError = errores.correo ? idCorreo : errores.password ? idPassword : null;
  useEffect(() => {
    if (primeroConError) document.getElementById(primeroConError)?.focus();
  }, [errores, primeroConError]);

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (enviandoRef.current) return;

    const locales: Errores = {};
    const errorCorreo = validarCorreo(correo);
    if (errorCorreo) locales.correo = errorCorreo;
    else if (correo.trim().toLowerCase() === correoActual.trim().toLowerCase()) {
      locales.correo = 'Es el mismo correo que ya usas.';
    }
    if (!password) locales.password = 'Escribe tu contraseña actual.';
    setErrores(locales);
    setErrorGeneral(null);
    if (Object.keys(locales).length > 0) return;

    enviandoRef.current = true;
    setEnviando(true);
    const sesion = capturarSesion();
    const destino = correo.trim();
    try {
      await onSolicitar({ correo: destino, password });
      // Respuesta de otra sesión: no se muestra como si fuera de esta.
      if (sesion !== capturarSesion()) {
        alCerrar();
        return;
      }
      setEnviadoA(destino);
    } catch (err: unknown) {
      if (sesion !== capturarSesion()) {
        alCerrar();
        return;
      }
      if (err instanceof AuthError && err.codigo === 'identidad_invalida') {
        setErrores({ password: 'La contraseña no es correcta.' });
      } else if (err instanceof AuthError && err.codigo === 'correo_no_disponible') {
        setErrores({ correo: 'Ese correo no está disponible. Prueba con otro.' });
      } else if (err instanceof AuthError && (err.codigo === 'limite_reenvio' || err.status === 429)) {
        setErrorGeneral(MENSAJE_LIMITE);
      } else if (err instanceof AuthError && err.status === 401) {
        setErrorGeneral(MENSAJE_SESION);
      } else if (err instanceof TypeError) {
        setErrorGeneral(MENSAJE_SIN_RED);
      } else if (err instanceof AuthError) {
        setErrorGeneral(err.message || MENSAJE_GENERICO);
      } else {
        setErrorGeneral(MENSAJE_GENERICO);
      }
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  if (enviadoA) {
    return (
      <Modal titulo="Revisa tu correo" alCerrar={alCerrar}>
        <div className={styles.formulario}>
          <p role="status">
            Te enviamos un enlace a <strong>{enviadoA}</strong>. Ábrelo para confirmar el cambio; dura 60 minutos.
          </p>
          <p className={styles.nota}>
            Mientras no lo confirmes, tu correo sigue siendo <strong>{correoActual}</strong>.
          </p>
          <div className={styles.acciones}>
            <Boton onClick={alCerrar}>Entendido</Boton>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      titulo="Cambiar correo"
      descripcion="Te mandamos un enlace al correo nuevo. El actual sigue activo hasta que lo confirmes."
      alCerrar={cerrarSiSePuede}
    >
      <form className={styles.formulario} onSubmit={enviar} noValidate>
        <CampoTexto
          id={idCorreo}
          etiqueta="Correo nuevo"
          type="email"
          autoComplete="email"
          value={correo}
          onChange={(evento) => setCorreo(evento.target.value)}
          error={errores.correo}
        />
        <CampoContrasena
          id={idPassword}
          etiqueta="Contraseña actual"
          value={password}
          onChange={(evento) => setPassword(evento.target.value)}
          error={errores.password}
          autoComplete="current-password"
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
            {enviando ? 'Enviando…' : 'Enviar enlace'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}
