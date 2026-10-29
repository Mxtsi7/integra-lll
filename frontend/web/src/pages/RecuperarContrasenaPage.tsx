import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { AuthError, validarCorreo } from '@ojoalgasto/shared';
import { PantallaAcceso } from '../components/layout/PantallaAcceso';
import { CampoTexto } from '../components/ui/Campo';
import { Boton } from '../components/ui/Boton';
import styles from './Acceso.module.css';

export interface RecuperarContrasenaProps {
  /**
   * Pide el enlace de recuperación al backend (CH-06). App.tsx lo conecta a
   * solicitarRecuperacion() de shared → POST /api/auth/password-reset/.
   * Debe lanzar si la solicitud no se pudo hacer (sin red, 400, 5xx).
   */
  onSolicitarRecuperacion?: (email: string) => Promise<void>;
}

// CH-06: el backend responde igual exista o no la cuenta (anti-enumeración).
// La pantalla tampoco puede distinguir: el mensaje es neutro y el mismo
// para todos los correos.
function mensajeDeError(err: unknown): string {
  if (err instanceof TypeError) {
    // fetch() sin red, servidor caído o CORS.
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  if (err instanceof AuthError) {
    // 400: correo mal formado según el backend; se muestra su mensaje.
    return err.campos?.email?.[0] ?? err.message;
  }
  return 'No pudimos procesar la solicitud. Intenta de nuevo.';
}

export const RecuperarContrasenaPage: React.FC<RecuperarContrasenaProps> = ({
  onSolicitarRecuperacion,
}) => {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // CH-25: el error del correo va en su campo (aria-invalid + descripción) y
  // el foco vuelve a él; antes era un aviso suelto y el foco se perdía.
  const [errorCorreo, setErrorCorreo] = useState<string | null>(null);

  // Sin handler real (CH-06) la funcionalidad no está disponible: no se simula éxito.
  const isAvailable = Boolean(onSolicitarRecuperacion);

  const mostrarErrorCorreo = (mensaje: string) => {
    setError(null);
    setErrorCorreo(mensaje);
    // Después del render: el campo pudo estar deshabilitado mientras se enviaba.
    setTimeout(() => document.getElementById('email')?.focus());
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Enviar una sola vez: un doble clic o Enter repetido no manda dos correos.
    if (!onSolicitarRecuperacion || isLoading) return;

    // Misma validación de correo que el registro (shared/validaciones.ts).
    const invalido = validarCorreo(email);
    if (invalido) {
      mostrarErrorCorreo(invalido);
      return;
    }

    setError(null);
    setErrorCorreo(null);
    setIsLoading(true);

    try {
      await onSolicitarRecuperacion(email.trim());
      setIsSubmitted(true);
    } catch (err: unknown) {
      // El formulario vuelve a quedar habilitado (finally) para reintentar.
      // Un 400 del campo email es un error del campo, no un aviso general.
      const delCampo = err instanceof AuthError ? err.campos?.email?.[0] : undefined;
      if (delCampo) mostrarErrorCorreo(delCampo);
      else setError(mensajeDeError(err));
    } finally {
      setIsLoading(false);
    }
  };

  const pie = (
    <>
      ¿Recordaste tu clave? <Link to="/login">Iniciar sesión</Link>
    </>
  );

  if (isSubmitted) {
    return (
      <PantallaAcceso titulo="Revisa tu correo" pie={pie}>
        <div className={styles.resultado}>
          <span className={styles.resultadoIcono}>
            <MailCheck size={26} aria-hidden="true" />
          </span>
          {/* Neutro a propósito: no confirma si la cuenta existe. */}
          <p className={styles.resultadoTexto} role="status">
            Si hay una cuenta con <strong>{email.trim()}</strong>, te enviamos un enlace para crear
            una contraseña nueva. Vence en 60 minutos. Si no llega, revisa la carpeta de spam.
          </p>
          <Boton variante="secundario" onClick={() => setIsSubmitted(false)}>
            Usar otro correo
          </Boton>
        </div>
      </PantallaAcceso>
    );
  }

  return (
    <PantallaAcceso
      titulo="Recuperar contraseña"
      descripcion="Te mandamos un enlace para crear una contraseña nueva."
      pie={pie}
    >
      <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {!isAvailable && (
          <p className={styles.aviso}>Esta función todavía no está disponible.</p>
        )}

        <CampoTexto
          id="email"
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.cl"
          icono={<Mail size={16} />}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErrorCorreo(null);
          }}
          error={errorCorreo ?? undefined}
          disabled={isLoading}
          required
        />

        <Boton type="submit" ancho cargando={isLoading} disabled={!isAvailable}>
          {isLoading ? 'Enviando…' : 'Enviar enlace'}
        </Boton>
      </form>
    </PantallaAcceso>
  );
};

export default RecuperarContrasenaPage;
