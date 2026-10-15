import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MailCheck } from 'lucide-react';
import { PantallaAcceso } from '../components/layout/PantallaAcceso';
import { CampoTexto } from '../components/ui/Campo';
import { Boton } from '../components/ui/Boton';
import styles from './Acceso.module.css';

export interface RecuperarContrasenaProps {
  /** Callback para conectar con el backend (CH-06) */
  onSolicitarRecuperacion?: (email: string) => Promise<void>;
}

export const RecuperarContrasenaPage: React.FC<RecuperarContrasenaProps> = ({
  onSolicitarRecuperacion,
}) => {
  const [email, setEmail] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin handler real (CH-06) la funcionalidad no está disponible: no se simula éxito.
  const isAvailable = Boolean(onSolicitarRecuperacion);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSolicitarRecuperacion) return;

    if (!email) {
      setError('Ingresa tu correo electrónico.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await onSolicitarRecuperacion(email);
      setIsSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'No pudimos procesar la solicitud. Intenta de nuevo.');
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
          <p className={styles.resultadoTexto}>
            Enviamos las instrucciones a <strong>{email}</strong>. Si no llega en unos minutos,
            revisa la carpeta de spam.
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
        {error && <p className={styles.error}>{error}</p>}
        {!isAvailable && (
          <p className={styles.aviso}>Esta función todavía no está disponible.</p>
        )}

        <CampoTexto
          id="email"
          etiqueta="Correo electrónico"
          type="email"
          placeholder="tu@correo.cl"
          icono={<Mail size={16} />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
