import {
  esUrlAutorizacionValida,
  type CuentaConectada,
  type ProveedorCorreo,
} from '@ojoalgasto/shared';
import { Link2, Plug } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ListaCuentas, type EstadoListaCuentas } from '../components/Cuentas/ListaCuentas';
import styles from '../components/Cuentas/Cuentas.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { Modal } from '../components/ui/Modal';
import { Seccion } from '../components/ui/Seccion';
import { useToast } from '../context/ToastContext';
import { MENSAJE_SIN_RED } from '../utils/mensajes';

const MENSAJE_ERROR = 'No pudimos cargar tus cuentas conectadas. Intenta de nuevo.';

export interface CuentasConectadasPageProps {
  cargarCuentas?: () => Promise<CuentaConectada[]>;
  accionConectar?: ReactNode;
  onDesconectar?: (id: string) => Promise<CuentaConectada>;
  onReautorizar?: (proveedor: ProveedorCorreo) => Promise<string>;
  redirigir?: (url: string) => void;
}

export function CuentasConectadasPage({
  cargarCuentas,
  accionConectar,
  onDesconectar,
  onReautorizar,
  redirigir = (url) => window.location.assign(url),
}: CuentasConectadasPageProps) {
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoListaCuentas>(
    cargarCuentas ? { tipo: 'cargando' } : { tipo: 'no_disponible' },
  );
  const [intento, setIntento] = useState(0);

  // Estado del modal de desconexión (AN-17)
  const [cuentaADesconectar, setCuentaADesconectar] = useState<CuentaConectada | null>(null);
  const [desconectando, setDesconectando] = useState(false);
  const [errorDesconexion, setErrorDesconexion] = useState('');

  // Estado de reautorización
  const [reautorizandoId, setReautorizandoId] = useState<string | null>(null);

  // Evita que una respuesta tardía de GET pise una cuenta recién revocada por DELETE.
  const revocadasRef = useRef(new Map<string, CuentaConectada>());

  useEffect(() => {
    if (!cargarCuentas) {
      setEstado({ tipo: 'no_disponible' });
      return;
    }
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    cargarCuentas()
      .then((cuentas: unknown) => {
        if (!vigente) return;
        if (!Array.isArray(cuentas)) {
          setEstado({ tipo: 'error', mensaje: MENSAJE_ERROR });
          return;
        }
        const consolidadas = (cuentas as CuentaConectada[]).map(
          (item) => revocadasRef.current.get(item.id) ?? item,
        );
        setEstado({ tipo: 'listo', cuentas: consolidadas });
      })
      .catch((err: unknown) => {
        if (vigente) {
          setEstado({ tipo: 'error', mensaje: err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR });
        }
      });
    return () => {
      vigente = false;
    };
  }, [cargarCuentas, intento]);

  function abrirModalDesconexion(cuenta: CuentaConectada) {
    setErrorDesconexion('');
    setCuentaADesconectar(cuenta);
  }

  function cerrarModalDesconexion() {
    if (desconectando) return;
    setCuentaADesconectar(null);
    setErrorDesconexion('');
  }

  async function confirmarDesconexion() {
    if (!cuentaADesconectar || !onDesconectar || desconectando) return;
    setDesconectando(true);
    setErrorDesconexion('');
    try {
      const actualizada = await onDesconectar(cuentaADesconectar.id);
      revocadasRef.current.set(actualizada.id, actualizada);
      setEstado((previo) => {
        if (previo.tipo !== 'listo') return previo;
        return {
          tipo: 'listo',
          cuentas: previo.cuentas.map((c) => (c.id === actualizada.id ? actualizada : c)),
        };
      });
      setCuentaADesconectar(null);
      toast.exito('Cuenta desconectada correctamente.');
    } catch (err: unknown) {
      setErrorDesconexion(
        err instanceof TypeError
          ? MENSAJE_SIN_RED
          : 'No pudimos desconectar la cuenta. Inténtalo de nuevo.',
      );
    } finally {
      setDesconectando(false);
    }
  }

  async function manejarReautorizar(cuenta: CuentaConectada) {
    if (!onReautorizar || reautorizandoId !== null) return;
    if (cuenta.proveedor !== 'gmail' && cuenta.proveedor !== 'outlook') return;

    setReautorizandoId(cuenta.id);
    try {
      const url = await onReautorizar(cuenta.proveedor);
      if (!esUrlAutorizacionValida(cuenta.proveedor, url)) {
        toast.error('No pudimos iniciar la reautorización de forma segura.');
        return;
      }
      redirigir(url);
    } catch {
      toast.error('No pudimos iniciar la reautorización. Intenta de nuevo.');
    } finally {
      setReautorizandoId(null);
    }
  }

  return (
    <AppLayout
      headerTitulo="Cuentas conectadas"
      headerSubtitulo="Conecta tu correo y los cobros nuevos se registran solos."
    >
      <div className={styles.grid}>
        <Seccion
          titulo="Conectar una cuenta"
          descripcion="Solo leemos los mensajes de cobros y suscripciones."
          icono={<Plug size={19} aria-hidden="true" />}
          tinte="turquesa"
        >
          {accionConectar ?? (
            <p className={styles.mensaje}>La conexión con Gmail y Outlook todavía no está disponible.</p>
          )}
        </Seccion>

        <Seccion
          titulo="Tus cuentas"
          icono={<Link2 size={19} aria-hidden="true" />}
          tinte="azul"
          accion={
            <BotonEnlace to="/importaciones" variante="sutil" tamano="s">
              Ver importaciones
            </BotonEnlace>
          }
        >
          <ListaCuentas
            estado={estado}
            onReintentar={() => {
              revocadasRef.current.clear();
              setIntento((anterior) => anterior + 1);
            }}
            onPedirDesconexion={onDesconectar ? abrirModalDesconexion : undefined}
            onReautorizar={
              onReautorizar
                ? (proveedor) => {
                    if (estado.tipo !== 'listo') return;
                    const objetivo = estado.cuentas.find(
                      (c) => c.proveedor === proveedor && c.necesita_reautorizacion,
                    );
                    if (objetivo) void manejarReautorizar(objetivo);
                  }
                : undefined
            }
            reautorizandoId={reautorizandoId}
          />
        </Seccion>
      </div>

      {cuentaADesconectar && (
        <Modal
          tipo="alerta"
          titulo="Desconectar cuenta"
          descripcion={`¿Seguro que quieres desconectar ${cuentaADesconectar.cuenta_externa}?`}
          alCerrar={cerrarModalDesconexion}
        >
          <p className={styles.cuentaExterna}>
            Dejaremos de leer mensajes nuevos de este correo. Las suscripciones que ya se importaron se
            conservarán en tu historial.
          </p>

          {errorDesconexion && (
            <p role="alert" className={styles.cuentaAviso}>
              {errorDesconexion}
            </p>
          )}

          <div className={styles.modalPie}>
            <Boton
              variante="sutil"
              disabled={desconectando}
              onClick={cerrarModalDesconexion}
            >
              Cancelar
            </Boton>
            <Boton
              variante="peligro"
              cargando={desconectando}
              disabled={desconectando}
              onClick={() => void confirmarDesconexion()}
            >
              Confirmar desconexión
            </Boton>
          </div>
        </Modal>
      )}
    </AppLayout>
  );
}
