import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './RecuperarContrasenaPage.module.css';

export interface RestablecerContrasenaProps {
  // Prop  por si Christopher prefiere inyectar el handler de la API directamente
  onSubmitNewPassword?: (password: string, token: string) => Promise<void>;
}

type StepState = 'form' | 'success' | 'expired' | 'invalid';

// Validación visual según RF-01.1: mínimo 8 caracteres, al menos una letra y un número.
// La validación definitiva se mantiene en el backend (CH-07).
const validarPassword = (value: string): string | null => {
  if (value.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/\p{L}/u.test(value)) return 'La contraseña debe incluir al menos una letra.';
  if (!/\d/.test(value)) return 'La contraseña debe incluir al menos un número.';
  return null;
};

export const RestablecerContrasenaPage: React.FC<RestablecerContrasenaProps> = ({
  onSubmitNewPassword
}) => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<StepState>('form');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sin handler real (CH-07) la funcionalidad no está disponible: no se simula éxito.
  const isAvailable = Boolean(onSubmitNewPassword);

  useEffect(() => {
    // Validación inicial de UX: Si no hay token en la URL, se marca como inválido
    if (!token) {
      setStatus('invalid');
    }
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onSubmitNewPassword || !token) return;

    const passwordError = validarPassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (password !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await onSubmitNewPassword(password, token);
      setStatus('success');
    } catch (err: any) {
      // Manejo de estados de error de token según contrato
      if (err?.status === 401 || err?.message?.includes('vencido')) {
        setStatus('expired');
      } else if (err?.status === 400 || err?.message?.includes('inválido')) {
        setStatus('invalid');
      } else {
        setError('Ocurrió un error al cambiar la contraseña. Inténtalo de nuevo.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <div className={styles.logo}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1b2a4a" strokeWidth="2">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span>Ojo al Gasto</span>
        </div>

        <div className={styles.card}>
          {/* ESTADO 1: FORMULARIO */}
          {status === 'form' && (
            <>
              <div className={styles.heading}>
                <h1>Restablecer contraseña</h1>
                <p>Ingresa tu nueva contraseña para actualizar tu acceso.</p>
              </div>

              {error && <div className={styles.error}>{error}</div>}

              {!isAvailable && (
                <div className={styles.error}>
                  Esta funcionalidad aún no está disponible.
                </div>
              )}

              <form onSubmit={handleSubmit}>
                <div className={styles.field}>
                  <label htmlFor="password">NUEVA CONTRASEÑA</label>
                  <div className={styles.fieldInput}>
                    <input
                      id="password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                  <small>Mínimo 8 caracteres, con al menos una letra y un número.</small>
                </div>

                <div className={styles.field}>
                  <label htmlFor="confirmPassword">CONFIRMAR CONTRASEÑA</label>
                  <div className={styles.fieldInput}>
                    <input
                      id="confirmPassword"
                      type="password"
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      disabled={isLoading}
                      required
                    />
                  </div>
                </div>

                <button type="submit" className={styles.submit} disabled={isLoading || !isAvailable}>
                  {isLoading ? 'Guardando...' : 'Cambiar contraseña'}
                </button>
              </form>
            </>
          )}

          {/* ESTADO 2: ÉXITO */}
          {status === 'success' && (
            <div className={styles.successBox}>
              <div className={styles.successIcon}>✓</div>
              <div className={styles.heading}>
                <h1>¡Contraseña actualizada!</h1>
                <p>Tu contraseña ha sido cambiada exitosamente.</p>
              </div>
              <Link to="/login" className={styles.submit} style={{ display: 'block', textDecoration: 'none' }}>
                Iniciar sesión
              </Link>
            </div>
          )}

          {/* ESTADO 3: ENLACE VENCIDO */}
          {status === 'expired' && (
            <div className={styles.successBox}>
              <div className={styles.successIcon} style={{ backgroundColor: '#fde8e8', color: '#c4453b' }}>⏳</div>
              <div className={styles.heading}>
                <h1>Enlace vencido</h1>
                <p>El enlace de recuperación ha expirado por seguridad. Solicita uno nuevo.</p>
              </div>
              <Link to="/recuperar-contrasena" className={styles.submit} style={{ display: 'block', textDecoration: 'none' }}>
                Solicitar nuevo enlace
              </Link>
            </div>
          )}

          {/* ESTADO 4: ENLACE INVÁLIDO */}
          {status === 'invalid' && (
            <div className={styles.successBox}>
              <div className={styles.successIcon} style={{ backgroundColor: '#fde8e8', color: '#c4453b' }}>✕</div>
              <div className={styles.heading}>
                <h1>Enlace inválido</h1>
                <p>El código de verificación no es válido o está incompleto.</p>
              </div>
              <Link to="/recuperar-contrasena" className={styles.submit} style={{ display: 'block', textDecoration: 'none' }}>
                Ir a recuperación
              </Link>
            </div>
          )}

          <div className={styles.divider}>
            <div className={styles.line} />
            <div className={styles.dot} />
            <div className={styles.line} />
          </div>

          <div className={styles.switch}>
            <Link to="/login">Volver al inicio de sesión</Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestablecerContrasenaPage;
