import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Ban, Hourglass, Mail, MailCheck, TriangleAlert } from 'lucide-react';
import { AuthError } from '@ojoalgasto/shared';
import { PantallaAcceso } from '../components/layout/PantallaAcceso';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import styles from './Acceso.module.css';

export interface VerificarCorreoProps {
  /**
   * Confirma el token en el backend (MX-28). App.tsx lo conecta a confirmarCorreo() de shared →
   * POST /api/auth/email-verification/confirm/. Debe lanzar AuthError con `codigo` si el enlace no sirve.
   */
  onConfirmar?: (token: string) => Promise<void>;
  /** Pide un enlace nuevo (exige sesión). App.tsx lo conecta a reenviarVerificacion() de shared. */
  onReenviar?: () => Promise<void>;
  /** ¿Hay sesión en este navegador? Decide entre "Reenviar enlace" e "Iniciar sesión". */
  haySesion?: () => boolean;
}

type Estado = 'verificando' | 'verificado' | 'vencido' | 'usado' | 'invalido' | 'no_disponible' | 'error';

// `code` que devuelve el backend (MX-28) → pantalla.
const ESTADO_POR_CODIGO: Record<string, Estado> = {
  token_expirado: 'vencido',
  token_usado: 'usado',
  token_invalido: 'invalido',
  correo_no_disponible: 'no_disponible',
};

function mensajeReenvio(err: unknown): string {
  if (err instanceof AuthError) {
    if (err.codigo === 'limite_reenvio' || err.status === 429) {
      return 'Pediste demasiados enlaces. Espera un minuto antes de intentar de nuevo (máximo 5 por hora).';
    }
    if (err.status === 401) return 'Tu sesión expiró. Inicia sesión e inténtalo de nuevo.';
  }
  if (err instanceof TypeError) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  return 'No pudimos enviar el enlace. Inténtalo de nuevo.';
}

interface ReenviarProps {
  onReenviar?: () => Promise<void>;
  haySesion: () => boolean;
}

function Reenviar({ onReenviar, haySesion }: ReenviarProps) {
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!haySesion()) {
    return <BotonEnlace to="/login">Inicia sesión para pedir un enlace nuevo</BotonEnlace>;
  }
  if (enviado) {
    return (
      <p className={styles.resultadoTexto} role="status">
        Te enviamos un enlace nuevo. Revisa tu correo y úsalo apenas llegue.
      </p>
    );
  }

  const reenviar = async () => {
    if (!onReenviar || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await onReenviar();
      setEnviado(true);
    } catch (err: unknown) {
      setError(mensajeReenvio(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <Boton type="button" ancho cargando={enviando} disabled={!onReenviar} onClick={reenviar}>
        {enviando ? 'Enviando…' : 'Reenviar enlace'}
      </Boton>
    </>
  );
}

interface ResultadoProps {
  icono: React.ReactNode;
  texto: string;
  children?: React.ReactNode;
}

function Resultado({ icono, texto, children }: ResultadoProps) {
  return (
    <div className={styles.resultado}>
      <span className={`${styles.resultadoIcono} ${styles.resultadoIconoAlerta}`}>{icono}</span>
      <p className={styles.resultadoTexto}>{texto}</p>
      {children}
    </div>
  );
}

export const VerificarCorreoPage: React.FC<VerificarCorreoProps> = ({
  onConfirmar,
  onReenviar,
  haySesion = () => false,
}) => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  // Sin token en la URL el enlace no sirve: se decide de entrada.
  const [estado, setEstado] = useState<Estado>(token ? 'verificando' : 'invalido');
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // El token es de un solo uso: en desarrollo React ejecuta los efectos dos veces y la segunda
  // llamada daría "enlace ya utilizado" aunque la primera haya funcionado. Se confirma una vez por token.
  const tokenEnviado = useRef<string | null>(null);

  const confirmar = useCallback(async () => {
    if (!onConfirmar || !token) return;
    setEstado('verificando');
    setErrorGeneral(null);
    try {
      await onConfirmar(token);
      // Solo aquí, tras la respuesta correcta de la API, el correo se muestra como verificado.
      setEstado('verificado');
    } catch (err: unknown) {
      if (err instanceof AuthError && err.codigo && err.codigo in ESTADO_POR_CODIGO) {
        setEstado(ESTADO_POR_CODIGO[err.codigo]);
      } else if (err instanceof TypeError) {
        setErrorGeneral('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
        setEstado('error');
      } else {
        // 503 u otro: el enlace sigue siendo válido y se puede reintentar.
        setErrorGeneral(
          err instanceof AuthError && err.message ? err.message : 'No pudimos verificar tu correo. Inténtalo de nuevo.',
        );
        setEstado('error');
      }
    }
  }, [onConfirmar, token]);

  useEffect(() => {
    if (!token || tokenEnviado.current === token) return;
    if (!onConfirmar) {
      // Sin handler real no se simula éxito.
      setErrorGeneral('Esta función todavía no está disponible.');
      setEstado('error');
      return;
    }
    tokenEnviado.current = token;
    void confirmar();
  }, [token, onConfirmar, confirmar]);

  const pie = <Link to="/login">Volver al inicio de sesión</Link>;
  const reenviar = <Reenviar onReenviar={onReenviar} haySesion={haySesion} />;

  switch (estado) {
    case 'verificando':
      return (
        <PantallaAcceso titulo="Verificando tu correo" pie={pie}>
          <div className={styles.resultado}>
            <p className={styles.resultadoTexto} role="status">
              Estamos confirmando tu enlace…
            </p>
          </div>
        </PantallaAcceso>
      );
    case 'verificado':
      return (
        <PantallaAcceso titulo="Correo verificado" pie={pie}>
          <Resultado icono={<MailCheck size={26} aria-hidden="true" />} texto="Tu correo quedó verificado.">
            {haySesion() ? (
              <BotonEnlace to="/dashboard">Ir al panel</BotonEnlace>
            ) : (
              <BotonEnlace to="/login">Iniciar sesión</BotonEnlace>
            )}
          </Resultado>
        </PantallaAcceso>
      );
    case 'vencido':
      return (
        <PantallaAcceso titulo="Enlace vencido" pie={pie}>
          <Resultado
            icono={<Hourglass size={26} aria-hidden="true" />}
            texto="Los enlaces duran 60 minutos por seguridad. Pide uno nuevo y úsalo apenas llegue."
          >
            {reenviar}
          </Resultado>
        </PantallaAcceso>
      );
    case 'usado':
      return (
        <PantallaAcceso titulo="Enlace ya utilizado" pie={pie}>
          <Resultado
            icono={<Ban size={26} aria-hidden="true" />}
            texto="Este enlace ya se usó. Si tu correo todavía no aparece como verificado, pide un enlace nuevo."
          >
            {reenviar}
          </Resultado>
        </PantallaAcceso>
      );
    case 'invalido':
      return (
        <PantallaAcceso titulo="Enlace inválido" pie={pie}>
          <Resultado
            icono={<TriangleAlert size={26} aria-hidden="true" />}
            texto="Este enlace no es válido, está incompleto o fue reemplazado por uno más nuevo. Revisa el último correo que recibiste o pide uno nuevo."
          >
            {reenviar}
          </Resultado>
        </PantallaAcceso>
      );
    case 'no_disponible':
      return (
        <PantallaAcceso titulo="Correo no disponible" pie={pie}>
          <Resultado
            icono={<Mail size={26} aria-hidden="true" />}
            texto="No pudimos verificar este correo porque no está disponible. Prueba con otro correo desde tu perfil."
          />
        </PantallaAcceso>
      );
    default:
      return (
        <PantallaAcceso titulo="No pudimos verificar tu correo" pie={pie}>
          <Resultado icono={<TriangleAlert size={26} aria-hidden="true" />} texto={errorGeneral ?? ''}>
            {onConfirmar && (
              <Boton type="button" ancho onClick={() => void confirmar()}>
                Reintentar
              </Boton>
            )}
          </Resultado>
        </PantallaAcceso>
      );
  }
};

export default VerificarCorreoPage;
