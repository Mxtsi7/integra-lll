import {
  esEntradaCallbackValida,
  procesarCallbackOAuth,
  type ResultadoCallbackOAuth,
} from '@ojoalgasto/shared';
import { CircleAlert, CircleCheck, CircleX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { BotonEnlace } from '../components/ui/Boton';
import { Seccion } from '../components/ui/Seccion';
import styles from '../components/Cuentas/Cuentas.module.css';

type EstadoRetorno =
  | { tipo: 'procesando' }
  | { tipo: 'conectada'; correo: string; proveedor: string }
  | { tipo: 'cancelada' }
  | { tipo: 'error'; mensaje: string };

export interface RetornoOAuthPageProps {
  onProcesarCallback?: typeof procesarCallbackOAuth;
}

export function RetornoOAuthPage({
  onProcesarCallback = procesarCallbackOAuth,
}: RetornoOAuthPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [estado, setEstado] = useState<EstadoRetorno>({ tipo: 'procesando' });
  const procesadoRef = useRef(false);

  useEffect(() => {
    if (procesadoRef.current) return;
    procesadoRef.current = true;

    const estadoOauth = searchParams.get('state') ?? '';
    const codigo = searchParams.get('code') ?? '';
    const errorProveedor = searchParams.get('error') ?? '';

    // Limpia inmediatamente parámetros sensibles de la barra de direcciones e historial.
    if (searchParams.toString().length > 0) {
      navigate('/oauth/retorno', { replace: true });
    }

    const entrada = {
      estado_oauth: estadoOauth,
      ...(codigo ? { codigo } : {}),
      ...(errorProveedor ? { error: errorProveedor } : {}),
    };

    if (!esEntradaCallbackValida(entrada)) {
      setEstado({
        tipo: 'error',
        mensaje: 'El enlace de autorización no es válido o está incompleto. Vuelve a intentarlo desde Cuentas.',
      });
      return;
    }

    onProcesarCallback(entrada)
      .then((resultado: ResultadoCallbackOAuth) => {
        if (resultado.tipo === 'cancelada') {
          setEstado({ tipo: 'cancelada' });
        } else {
          setEstado({
            tipo: 'conectada',
            correo: resultado.cuenta.cuenta_externa,
            proveedor: resultado.cuenta.proveedor_legible,
          });
        }
      })
      .catch(() => {
        setEstado({
          tipo: 'error',
          mensaje: 'No pudimos completar la conexión con tu correo. Es posible que el permiso haya vencido.',
        });
      });
  }, [navigate, onProcesarCallback, searchParams]);

  return (
    <AppLayout
      headerTitulo="Conexión de correo"
      headerSubtitulo="Verificando la autorización con tu proveedor."
    >
      <Seccion titulo="Resultado de la autorización" tinte="turquesa">
        {estado.tipo === 'procesando' && (
          <div className={styles.mensaje}>
            <Spinner size={22} etiqueta="Verificando autorización" />
          </div>
        )}

        {estado.tipo === 'conectada' && (
          <div className={styles.retornoBloque} role="status">
            <CircleCheck size={24} aria-hidden="true" />
            <div>
              <p className={styles.cuentaProveedor}>Cuenta conectada correctamente</p>
              <p className={styles.cuentaExterna}>
                {estado.proveedor} ({estado.correo}) ya está lista para detectar cobros.
              </p>
            </div>
            <BotonEnlace to="/cuentas" variante="primario">
              Volver a mis cuentas
            </BotonEnlace>
          </div>
        )}

        {estado.tipo === 'cancelada' && (
          <div className={styles.retornoBloque} role="status">
            <CircleX size={24} aria-hidden="true" />
            <div>
              <p className={styles.cuentaProveedor}>Autorización cancelada</p>
              <p className={styles.cuentaExterna}>
                Cancelaste el permiso en tu proveedor de correo. No se conectó ninguna cuenta.
              </p>
            </div>
            <BotonEnlace to="/cuentas" variante="secundario">
              Volver a mis cuentas
            </BotonEnlace>
          </div>
        )}

        {estado.tipo === 'error' && (
          <div className={styles.retornoBloque} role="alert">
            <CircleAlert size={24} aria-hidden="true" />
            <div>
              <p className={styles.cuentaProveedor}>No se pudo conectar la cuenta</p>
              <p className={styles.cuentaExterna}>{estado.mensaje}</p>
            </div>
            <BotonEnlace to="/cuentas" variante="secundario">
              Volver a mis cuentas
            </BotonEnlace>
          </div>
        )}
      </Seccion>
    </AppLayout>
  );
}
