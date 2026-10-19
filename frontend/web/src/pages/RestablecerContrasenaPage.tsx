import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Hourglass, Lock, TriangleAlert } from 'lucide-react';
import { PantallaAcceso } from '../components/layout/PantallaAcceso';
import { CampoTexto } from '../components/ui/Campo';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import styles from './Acceso.module.css';

export interface RestablecerContrasenaProps {
  // Prop por si Christopher prefiere inyectar el handler de la API directamente
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
  onSubmitNewPassword,
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
    // Si no hay token en la URL, el enlace no sirve.
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
        setError('No pudimos cambiar la contraseña. Intenta de nuevo.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const pie = <Link to="/login">Volver al inicio de sesión</Link>;

  if (status === 'success') {
    return (
      <PantallaAcceso titulo="Contraseña actualizada" pie={pie}>
        <div className={styles.resultado}>
          <span className={styles.resultadoIcono}>
            <CheckCircle2 size={26} aria-hidden="true" />
          </span>
          <p className={styles.resultadoTexto}>Ya puedes entrar con tu contraseña nueva.</p>
          <BotonEnlace to="/login">Iniciar sesión</BotonEnlace>
        </div>
      </PantallaAcceso>
    );
  }

  if (status === 'expired') {
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

  if (status === 'invalid') {
    return (
      <PantallaAcceso titulo="Enlace inválido" pie={pie}>
        <div className={styles.resultado}>
          <span className={`${styles.resultadoIcono} ${styles.resultadoIconoAlerta}`}>
            <TriangleAlert size={26} aria-hidden="true" />
          </span>
          <p className={styles.resultadoTexto}>
            Este enlace está incompleto o ya se usó. Pide uno nuevo desde la recuperación.
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
        {error && <p className={styles.error}>{error}</p>}
        {!isAvailable && (
          <p className={styles.aviso}>Esta función todavía no está disponible.</p>
        )}

        <CampoTexto
          id="password"
          etiqueta="Nueva contraseña"
          type="password"
          placeholder="Mínimo 8 caracteres"
          ayuda="Al menos 8 caracteres, con una letra y un número."
          icono={<Lock size={16} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={isLoading}
          required
        />

        <CampoTexto
          id="confirmPassword"
          etiqueta="Repite la contraseña"
          type="password"
          placeholder="La misma de arriba"
          icono={<Lock size={16} />}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
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
