import { AuthError, loginConGoogle, pedirNonceGoogle } from '@ojoalgasto/shared';
import { Lock } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { cargarGoogleIdentity } from '../../utils/googleIdentity';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import { Boton } from '../ui/Boton';
import { CampoContrasena } from '../ui/Campo';
import styles from './InicioConGoogle.module.css';

type Tokens = { access_token: string; refresh_token: string };

const MENSAJE_GENERICO = 'No pudimos iniciar sesión con Google. Inténtalo de nuevo.';

interface InicioConGoogleProps {
  /** Guarda la sesión y lleva a la página de destino. Si lanza, el inicio con Google falla y no queda sesión. */
  alIniciarSesion: (tokens: Tokens) => void;
  // Las tres piezas externas se pueden reemplazar en las pruebas.
  pedirNonce?: typeof pedirNonceGoogle;
  iniciarConGoogle?: typeof loginConGoogle;
  cargarGoogle?: typeof cargarGoogleIdentity;
}

type Estado = 'cargando' | 'listo' | 'error' | 'oculto';

/**
 * "Continuar con Google" en el Login (S3-AN-07, contrato MX-11).
 *
 * Es solo identidad: no da permiso para leer Gmail. El backend valida la
 * credencial de Google y su nonce, y responde con la sesión propia de la app.
 *
 * - Cada intento usa un nonce nuevo, que el backend gasta apenas lo recibe.
 *   Por eso, tras cualquier respuesta que no inicie sesión se pide otro y se
 *   vuelve a dibujar el botón.
 * - Si la cuenta ya existe con correo y contraseña, Google no basta para
 *   entrar: se pide la contraseña una vez para vincular, y la persona toca el
 *   botón otra vez (la credencial anterior ya no sirve).
 * - Cancelar o fallar no crea sesión ni muestra éxito. Si cerrar la ventana de
 *   Google no avisa nada, la pantalla queda como estaba.
 * - Si mientras se esperaba la respuesta cambió la sesión (otra pestaña entró),
 *   esa respuesta se descarta.
 */
export function InicioConGoogle({
  alIniciarSesion,
  pedirNonce = pedirNonceGoogle,
  iniciarConGoogle = loginConGoogle,
  cargarGoogle = cargarGoogleIdentity,
}: InicioConGoogleProps) {
  const { capturarSesion } = useAuth();
  const contenedor = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<Estado>('cargando');
  const [aviso, setAviso] = useState<string | null>(null);
  const [sinCuenta, setSinCuenta] = useState(false);
  const [vinculando, setVinculando] = useState(false);
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);

  // La contraseña más reciente, para la función que Google llama después.
  const passwordRef = useRef('');
  const vinculandoRef = useRef(false);
  // Número del nonce vigente: una credencial de un intento anterior se ignora.
  const intento = useRef(0);
  const enviandoRef = useRef(false);
  const vivo = useRef(true);
  // La versión más reciente de la función de la página: Google llama al callback
  // que se registró al dibujar el botón, que puede ser de un render anterior.
  const iniciarSesionRef = useRef(alIniciarSesion);
  useEffect(() => {
    iniciarSesionRef.current = alIniciarSesion;
  }, [alIniciarSesion]);

  const preparar = useCallback(async () => {
    const miIntento = ++intento.current;
    const vigente = () => vivo.current && miIntento === intento.current;
    setEstado('cargando');
    try {
      const [google, datos] = await Promise.all([cargarGoogle(), pedirNonce()]);
      if (!vigente() || !contenedor.current) return;

      google.initialize({
        client_id: datos.client_id,
        nonce: datos.nonce,
        callback: ({ credential }) => void recibirCredencial(credential, datos.nonce, miIntento),
      });
      contenedor.current.replaceChildren();
      google.renderButton(contenedor.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        locale: 'es',
        width: 320,
      });
      setEstado('listo');
    } catch (err: unknown) {
      if (!vigente()) return;
      // Sin configurar en el servidor: no se ofrece, no es un error de la persona.
      setEstado(err instanceof AuthError && err.codigo === 'google_no_configurado' ? 'oculto' : 'error');
    }
  }, [cargarGoogle, pedirNonce]);

  async function recibirCredencial(credencial: string, nonce: string, miIntento: number) {
    if (!vivo.current || miIntento !== intento.current || enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setAviso(null);
    setSinCuenta(false);
    const sesion = capturarSesion();
    try {
      const tokens = await iniciarConGoogle({
        idToken: credencial,
        nonce,
        password: passwordRef.current || undefined,
      });
      // Entró otra sesión mientras tanto: esta respuesta ya no es de esta pantalla.
      if (!vivo.current || sesion !== capturarSesion()) return;
      iniciarSesionRef.current(tokens);
    } catch (err: unknown) {
      if (!vivo.current || sesion !== capturarSesion()) return;
      mostrarError(err);
      // El nonce ya se gastó: el siguiente toque necesita uno nuevo.
      void preparar();
    } finally {
      enviandoRef.current = false;
      if (vivo.current) setEnviando(false);
    }
  }

  function mostrarError(err: unknown) {
    if (err instanceof AuthError && err.codigo === 'vincular_google') {
      // Con contraseña ya escrita, volver a recibir este código es que no coincide.
      setAviso(
        vinculandoRef.current && passwordRef.current
          ? 'La contraseña no es correcta. Inténtalo de nuevo y toca el botón de Google.'
          : 'Ya tienes una cuenta con este correo. Escribe su contraseña y toca de nuevo el botón de Google para vincularla.',
      );
      vinculandoRef.current = true;
      setVinculando(true);
    } else if (err instanceof AuthError && err.codigo === 'completar_registro') {
      setAviso('No hay una cuenta con ese correo. Regístrate primero y después podrás entrar con Google.');
      setSinCuenta(true);
    } else if (err instanceof AuthError && err.codigo === 'google_cancelado') {
      setAviso('Cancelaste el inicio con Google.');
    } else if (err instanceof AuthError && err.codigo === 'google_invalido') {
      setAviso('No pudimos validar tu cuenta de Google. Inténtalo de nuevo.');
    } else if (err instanceof TypeError) {
      setAviso(MENSAJE_SIN_RED);
    } else if (err instanceof AuthError && err.status >= 500) {
      setAviso(err.message || MENSAJE_GENERICO);
    } else {
      setAviso(MENSAJE_GENERICO);
    }
  }

  useEffect(() => {
    vivo.current = true;
    void preparar();
    return () => {
      vivo.current = false;
      intento.current++;
    };
  }, [preparar]);

  if (estado === 'oculto') return null;

  return (
    <div className={styles.contenedor}>
      <div className={styles.separador}>o</div>

      {vinculando && (
        <CampoContrasena
          id="password-google"
          etiqueta="Contraseña de tu cuenta"
          autoComplete="current-password"
          icono={<Lock size={16} />}
          value={password}
          onChange={(evento) => {
            passwordRef.current = evento.target.value;
            setPassword(evento.target.value);
          }}
        />
      )}

      <div ref={contenedor} className={styles.botonGoogle} data-testid="boton-google" />

      {estado === 'cargando' && (
        <p className={styles.nota} role="status">
          Cargando Google…
        </p>
      )}
      {enviando && (
        <p className={styles.nota} role="status">
          Entrando con Google…
        </p>
      )}
      {estado === 'error' && (
        <>
          <p className={styles.nota} role="status">
            No pudimos cargar el inicio con Google. Puedes entrar con tu correo y contraseña.
          </p>
          <Boton variante="secundario" tamano="s" onClick={() => void preparar()}>
            Reintentar con Google
          </Boton>
        </>
      )}
      {aviso && (
        <p className={styles.error} role="alert">
          {aviso}
        </p>
      )}
      {sinCuenta && (
        <Link className={styles.enlace} to="/registro">
          Crear una cuenta
        </Link>
      )}
    </div>
  );
}
