import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ban, Hourglass, Lock, TriangleAlert } from 'lucide-react';
import { AuthError, validarPassword, type CodigoErrorEnlace } from '@ojoalgasto/shared';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { PantallaAcceso } from '../components/layout/PantallaAcceso';
import { CampoContrasena } from '../components/ui/Campo';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import styles from './Acceso.module.css';

export interface RestablecerContrasenaProps {
  /**
   * Cambia la contraseña en el backend (CH-07). App.tsx lo conecta a
   * restablecerContrasena() de shared → POST /api/auth/password-reset/confirm/.
   * Debe lanzar AuthError con `codigo` si el enlace no sirve (MX-04).
   */
  onSubmitNewPassword?: (password: string, token: string) => Promise<void>;
}

// Estados del enlace según el `code` que devuelve el backend (MX-04).
// Antes se adivinaba con el status (401 = vencido) o buscando "vencido" en el
// mensaje, y "ya utilizado" no existía como estado.
type EstadoEnlace = 'formulario' | 'vencido' | 'invalido' | 'usado';

const ESTADO_POR_CODIGO: Record<CodigoErrorEnlace, EstadoEnlace> = {
  token_expirado: 'vencido',
  token_invalido: 'invalido',
  token_usado: 'usado',
};

const MENSAJE_EXITO = 'Contraseña actualizada. Inicia sesión con tu contraseña nueva.';

type ErroresCampos = { password?: string; confirmacion?: string };

export const RestablecerContrasenaPage: React.FC<RestablecerContrasenaProps> = ({
  onSubmitNewPassword,
}) => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();
  const toast = useToast();
  const { cerrarSesionLocal } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Sin token en la URL el enlace no sirve: se decide de entrada, sin
  // mostrar el formulario ni un instante.
  const [estado, setEstado] = useState<EstadoEnlace>(token ? 'formulario' : 'invalido');
  const [isLoading, setIsLoading] = useState(false);
  const [errores, setErrores] = useState<ErroresCampos>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  // Sin handler real (CH-07) la funcionalidad no está disponible: no se simula éxito.
  const isAvailable = Boolean(onSubmitNewPassword);

  // Después del render: el campo pudo estar deshabilitado mientras se enviaba.
  const enfocar = (id: 'password' | 'confirmPassword') => {
    setTimeout(() => document.getElementById(id)?.focus());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmitNewPassword || !token || isLoading) return;

    // Misma política que el registro y el backend (shared/validaciones.ts).
    const locales: ErroresCampos = {};
    const errorPassword = validarPassword(password);
    if (errorPassword) locales.password = errorPassword;
    if (!confirmPassword) locales.confirmacion = 'Repite la contraseña.';
    else if (password !== confirmPassword) locales.confirmacion = 'Las contraseñas no coinciden.';
    setErrores(locales);
    setErrorGeneral(null);
    if (locales.password || locales.confirmacion) {
      // CH-25: el foco va al primer campo con error, como en el registro.
      enfocar(locales.password ? 'password' : 'confirmPassword');
      return;
    }

    setIsLoading(true);
    try {
      await onSubmitNewPassword(password, token);
      // El backend revocó todas las sesiones abiertas y no inicia sesión:
      // si había una en este navegador ya no sirve. Se borra sin llamar al
      // backend y se termina en el Login con la confirmación.
      cerrarSesionLocal();
      toast.exito(MENSAJE_EXITO);
      navigate('/login', { replace: true });
    } catch (err: unknown) {
      // Ningún error toca la sesión: un enlace malo no cierra sesión a nadie.
      if (err instanceof AuthError && err.codigo && err.codigo in ESTADO_POR_CODIGO) {
        setEstado(ESTADO_POR_CODIGO[err.codigo as CodigoErrorEnlace]);
      } else if (err instanceof AuthError && err.campos?.password) {
        setErrores({ password: err.campos.password.join(' ') });
        enfocar('password');
      } else if (err instanceof TypeError) {
        setErrorGeneral('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
      } else if (err instanceof AuthError) {
        // 503 u otro: la contraseña no cambió; se puede reintentar.
        setErrorGeneral(err.message || 'No pudimos cambiar la contraseña. Intenta de nuevo.');
      } else {
        setErrorGeneral('No pudimos cambiar la contraseña. Intenta de nuevo.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const pie = <Link to="/login">Volver al inicio de sesión</Link>;

  if (estado === 'vencido') {
    return (
      <PantallaAcceso titulo="Enlace vencido" pie={pie}>
        <div className={styles.resultado}>
          <span className={`${styles.resultadoIcono} ${styles.resultadoIconoAlerta}`}>
            <Hourglass size={26} aria-hidden="true" />
          </span>
          <p className={styles.resultadoTexto}>
            Los enlaces duran 60 minutos por seguridad. Pide uno nuevo y úsalo apenas llegue.
          </p>
          <BotonEnlace to="/recuperar-contrasena">Pedir un enlace nuevo</BotonEnlace>
        </div>
      </PantallaAcceso>
    );
  }

  if (estado === 'usado') {
    return (
      <PantallaAcceso titulo="Enlace ya utilizado" pie={pie}>
        <div className={styles.resultado}>
          <span className={`${styles.resultadoIcono} ${styles.resultadoIconoAlerta}`}>
            <Ban size={26} aria-hidden="true" />
          </span>
          <p className={styles.resultadoTexto}>
            Este enlace ya se usó para cambiar la contraseña. Si necesitas cambiarla otra vez, pide
            un enlace nuevo.
          </p>
          <BotonEnlace to="/recuperar-contrasena">Pedir un enlace nuevo</BotonEnlace>
        </div>
      </PantallaAcceso>
    );
  }

  if (estado === 'invalido') {
    return (
      <PantallaAcceso titulo="Enlace inválido" pie={pie}>
        <div className={styles.resultado}>
          <span className={`${styles.resultadoIcono} ${styles.resultadoIconoAlerta}`}>
            <TriangleAlert size={26} aria-hidden="true" />
          </span>
          <p className={styles.resultadoTexto}>
            Este enlace no es válido o está incompleto. Pide uno nuevo desde la recuperación.
          </p>
          <BotonEnlace to="/recuperar-contrasena">Ir a recuperación</BotonEnlace>
        </div>
      </PantallaAcceso>
    );
  }

  return (
    <PantallaAcceso
      titulo="Restablecer contraseña"
      descripcion="Elige una contraseña nueva para tu cuenta."
      pie={pie}
    >
      <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
        {errorGeneral && (
          <p className={styles.error} role="alert">
            {errorGeneral}
          </p>
        )}
        {!isAvailable && (
          <p className={styles.aviso}>Esta función todavía no está disponible.</p>
        )}

        <CampoContrasena
          id="password"
          etiqueta="Nueva contraseña"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          ayuda="Al menos 8 caracteres, con una letra y un número."
          icono={<Lock size={16} />}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setErrores((actuales) => ({ ...actuales, password: undefined }));
          }}
          error={errores.password}
          disabled={isLoading}
          required
        />

        <CampoContrasena
          id="confirmPassword"
          etiqueta="Repite la contraseña"
          autoComplete="new-password"
          placeholder="La misma de arriba"
          icono={<Lock size={16} />}
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            setErrores((actuales) => ({ ...actuales, confirmacion: undefined }));
          }}
          error={errores.confirmacion}
          disabled={isLoading}
          required
        />

        <Boton type="submit" ancho cargando={isLoading} disabled={!isAvailable}>
          {isLoading ? 'Guardando…' : 'Cambiar contraseña'}
        </Boton>
      </form>
    </PantallaAcceso>
  );
};

export default RestablecerContrasenaPage;
