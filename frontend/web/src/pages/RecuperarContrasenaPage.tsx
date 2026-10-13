import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './RecuperarContrasenaPage.module.css';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) {
      setError('Por favor, ingresa tu correo electrónico.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      if (onSolicitarRecuperacion) {
        await onSolicitarRecuperacion(email);
      } else {
        // Simulación por defecto hasta integración en CH-06
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      setIsSubmitted(true);
    } catch (err: any) {
      setError(err?.message || 'Ocurrió un error al procesar la solicitud.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        {/* Logo Ojo al Gasto */}
        <div className={styles.logo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1b2a4a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>Ojo al Gasto</span>
        </div>

        <div className={styles.card}>
          {!isSubmitted ? (
            <>
              <div className={styles.heading}>
                <h1>Recuperar contraseña</h1>
                <p>Ingresa tu correo para ver las instrucciones de restablecimiento.</p>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <form onSubmit={handleSubmit}>
                <div className={styles.field}>
                  <label htmlFor="email">CORREO ELECTRÓNICO</label>
                  <div className={styles.fieldInput}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8a93ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                    <input
                      id="email"
                      type="email"
                      placeholder="usuario@ejemplo.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className={styles.submit} disabled={isLoading}>
                  {isLoading ? 'Enviando...' : 'Enviar instrucciones'}
                </button>
              </form>
            </>
          ) : (
            <div className={styles.successBox}>
              <div className={styles.successIcon}>✓</div>
              <div className={styles.heading}>
                <h1>¡Correo enviado!</h1>
                <p>
                  Hemos enviado las instrucciones de recuperación a <strong>{email}</strong>.
                </p>
              </div>
              <button
                type="button"
                className={styles.submit}
                onClick={() => setIsSubmitted(false)}
              >
                Reintentar con otro correo
              </button>
            </div>
          )}

          <div className={styles.divider}>
            <div className={styles.line} />
            <div className={styles.dot} />
            <div className={styles.line} />
          </div>

          <div className={styles.switch}>
            ¿Recordaste tu clave? <Link to="/login">Iniciar sesión</Link>
          </div>
        </div>

        <div className={styles.footnote}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#8a93ab" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>Conexión cifrada de extremo a extremo</span>
        </div>
      </div>
    </div>
  );
};

export default RecuperarContrasenaPage;
