import {
  cancelarSuscripcion,
  costoPorHora,
  equivalenteMensual,
  ErrorDeApi,
  formatearFecha,
  formatearHoras,
  formatearMonto,
  getSuscripcion,
  getUsos,
  registrarUso,
  type Suscripcion,
} from '@ojoalgasto/shared';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton } from '../components/ui/Boton';
import { Insignia } from '../components/ui/Insignia';
import { Modal } from '../components/ui/Modal';
import CancelarSuscripcionDialog from '../components/subscriptions/CancelarSus';
import { useToast } from '../context/ToastContext';
import {
  usePresentacionCategoria,
  cuandoEnDias,
  ESTADOS,
  etiquetaFrecuencia,
  sufijoFrecuencia,
} from '../components/subscriptions/presentacion';
import RegistrarUsoForm from '../components/subscriptions/RegistrarUsoForm';
import HistorialUso, { type EstadoHistorial } from '../components/subscriptions/HistorialUso';
import { diasHasta } from '../utils/fechas';
import styles from './SuscripcionDetallePage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'no-encontrada' }
  | { tipo: 'listo'; suscripcion: Suscripcion };

/** Qué decir si la cancelación no se pudo hacer (CH-10). La suscripción no cambió. */
function mensajeErrorCancelacion(err: unknown): string {
  if (err instanceof TypeError) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  if (err instanceof ErrorDeApi) {
    if (err.status === 403) return 'No tienes permiso para cancelar esta suscripción.';
    if (err.status === 404) return 'Esta suscripción ya no existe. Puede que la hayan eliminado.';
    if (err.message) return err.message;
  }
  return 'No pudimos cancelar la suscripción. Intenta de nuevo.';
}

export function SuscripcionDetallePage() {
  const categoriaVisual = usePresentacionCategoria();
  const { id } = useParams<{ id: string }>();
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });
  const [historial, setHistorial] = useState<EstadoHistorial>({ tipo: 'cargando' });
  const [recargaHistorial, setRecargaHistorial] = useState(0);

  // La suscripción que se está mirando AHORA. Una respuesta que llega tarde
  // de otra suscripción (si se navegó entre detalles) se descarta: así no se
  // mezclan datos ni usos de dos suscripciones (CH-15).
  const idActual = useRef(id);
  // De qué suscripción es el historial que se muestra: si es la misma, al
  // recargarlo no se vuelve a "Cargando…" (la lista no parpadea).
  const historialDe = useRef<string | undefined>(undefined);

  // CH-10: confirmación de cancelar. Mientras la petición viaja el diálogo
  // no se puede cerrar: el resultado decide qué se muestra.
  const toast = useToast();
  const [confirmandoCancelacion, setConfirmandoCancelacion] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const cancelandoRef = useRef(false);
  const [errorCancelacion, setErrorCancelacion] = useState<string | null>(null);

  useEffect(() => {
    idActual.current = id;
    // Al pasar a otra suscripción no queda abierta la confirmación de la anterior.
    setConfirmandoCancelacion(false);
    setErrorCancelacion(null);
    if (!id) return;
    let cancelado = false;
    setEstado({ tipo: 'cargando' });

    // Antes se pedía la lista completa y se buscaba el id (había un TODO
    // esperando este endpoint). GET /suscripciones/<id>/ ya existe.
    getSuscripcion(id)
      .then((suscripcion) => {
        if (!cancelado) setEstado({ tipo: 'listo', suscripcion });
      })
      .catch((err: unknown) => {
        if (cancelado) return;
        if (err instanceof ErrorDeApi && err.status === 404) setEstado({ tipo: 'no-encontrada' });
        else setEstado({ tipo: 'error', mensaje: 'No pudimos cargar esta suscripción.' });
      });

    return () => {
      cancelado = true;
    };
  }, [id]);

  // Historial de uso (CH-15): GET /suscripciones/<id>/uso/.
  useEffect(() => {
    if (!id) return;
    let cancelado = false;
    if (historialDe.current !== id) setHistorial({ tipo: 'cargando' });

    getUsos(id)
      .then((usos) => {
        if (cancelado) return;
        historialDe.current = id;
        setHistorial({ tipo: 'listo', usos });
      })
      .catch(() => {
        if (!cancelado) setHistorial({ tipo: 'error' });
      });

    return () => {
      cancelado = true;
    };
  }, [id, recargaHistorial]);

  const recargarHistorial = useCallback(() => setRecargaHistorial((n) => n + 1), []);

  // CH-14: registra el uso y refresca lo que depende de él.
  const registrar = useCallback(
    async (minutos: number, fecha?: string) => {
      if (!id) return;
      // Sin fecha se omite la propiedad: { minutos } es válido para la API y
      // usa hoy; { minutos, fecha: "" } no lo es.
      const actualizada = await registrarUso(id, fecha ? { minutos, fecha } : { minutos });
      if (idActual.current !== id) return; // se navegó a otra suscripción
      // La respuesta trae la suscripción actualizada: horas de uso del mes y
      // costo por hora se recalculan con ella, sin otra petición.
      setEstado({ tipo: 'listo', suscripcion: actualizada });
      // El historial se vuelve a pedir en vez de agregar la fila a mano: así
      // el registro nuevo aparece una sola vez y en el orden del backend.
      recargarHistorial();
    },
    [id, recargarHistorial],
  );

  const abrirCancelacion = useCallback(() => {
    setErrorCancelacion(null);
    setConfirmandoCancelacion(true);
  }, []);

  // "Volver", la X y Escape: no se llama a la API ni cambia nada.
  const cerrarCancelacion = useCallback(() => {
    if (cancelandoRef.current) return;
    setErrorCancelacion(null);
    setConfirmandoCancelacion(false);
  }, []);

  // Usa la transición del backend (POST .../cancelar/, VI-03), no DELETE: la
  // suscripción se queda con su historial y deja de proyectar cobros.
  const confirmarCancelacion = async () => {
    if (!id || estado.tipo !== 'listo' || cancelandoRef.current) return;
    const nombre = estado.suscripcion.nombre;
    cancelandoRef.current = true;
    setCancelando(true);
    setErrorCancelacion(null);
    try {
      const cancelada = await cancelarSuscripcion(id);
      if (idActual.current !== id) return; // se navegó a otra suscripción
      setEstado({ tipo: 'listo', suscripcion: cancelada });
      setConfirmandoCancelacion(false);
      toast.exito(`Cancelaste ${nombre}. Ya no contamos sus próximos cobros.`);
    } catch (err: unknown) {
      if (idActual.current === id) setErrorCancelacion(mensajeErrorCancelacion(err));
    } finally {
      cancelandoRef.current = false;
      setCancelando(false);
    }
  };

  return (
    <AppLayout
      headerTitulo={estado.tipo === 'listo' ? estado.suscripcion.nombre : 'Suscripción'}
      headerSubtitulo={estado.tipo === 'listo' ? categoriaVisual(estado.suscripcion.categoria).etiqueta : undefined}
      angosto
    >
      <Link to="/home" className={styles.volver}>
        <ArrowLeft size={15} aria-hidden="true" />
        Volver a Inicio
      </Link>

      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando…</p>}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'no-encontrada' && (
        <p className={styles.mensaje}>No encontramos esa suscripción. Puede que haya sido eliminada.</p>
      )}
      {estado.tipo === 'listo' && (
        <>
          <ContenidoDetalle suscripcion={estado.suscripcion} onCancelar={abrirCancelacion} />

          <section className={`tile ${styles.seccionUso}`} aria-labelledby="titulo-uso">
            <h2 id="titulo-uso" className={styles.seccionTitulo}>
              Uso
            </h2>
            <p className={styles.seccionDescripcion}>
              Anota cuánto la usas: así sabemos cuánto te cuesta cada hora y si la estás pagando sin usar.
            </p>
            {/* key: al pasar a otra suscripción el formulario empieza de cero. */}
            <RegistrarUsoForm key={id} onRegistrar={registrar} />

            <h3 className={styles.subtitulo}>Historial</h3>
            <HistorialUso estado={historial} onReintentar={recargarHistorial} />
          </section>

          {confirmandoCancelacion && (
            <Modal titulo={`¿Cancelar ${estado.suscripcion.nombre}?`} alCerrar={cerrarCancelacion} tipo="alerta">
              <CancelarSuscripcionDialog
                nombreSuscripcion={estado.suscripcion.nombre}
                onConfirm={confirmarCancelacion}
                onVolver={cerrarCancelacion}
                isCancelling={cancelando}
                error={errorCancelacion}
              />
            </Modal>
          )}
        </>
      )}
    </AppLayout>
  );
}

function ContenidoDetalle({ suscripcion, onCancelar }: { suscripcion: Suscripcion; onCancelar: () => void }) {
  const categoriaVisual = usePresentacionCategoria();
  const montoMensual = equivalenteMensual(suscripcion.monto, suscripcion.frecuencia);
  const porHora = costoPorHora(montoMensual, suscripcion.horas_uso_mes ?? 0);
  const info = ESTADOS[suscripcion.estado];
  const { Icono, color, suave } = categoriaVisual(suscripcion.categoria);
  const dias = diasHasta(suscripcion.fecha_proximo_cobro);
  const cancelada = suscripcion.estado === 'cancelado';

  return (
    <div className={`tile ${styles.tarjeta}`} style={{ '--tinte': suave } as React.CSSProperties}>
      <div className={styles.encabezado}>
        <span className={styles.icono} style={{ color }}>
          <Icono size={28} aria-hidden="true" />
        </span>
        <div className={styles.encabezadoTexto}>
          <p className={styles.monto}>
            {formatearMonto(suscripcion.monto, suscripcion.moneda)}
            <span className={styles.periodo}>{sufijoFrecuencia(suscripcion.frecuencia)}</span>
          </p>
          {suscripcion.frecuencia === 'anual' && (
            <p className={styles.equivalente}>
              Equivale a {formatearMonto(montoMensual, suscripcion.moneda)} al mes
            </p>
          )}
        </div>
        <Insignia tono={info.tono} className={styles.estado}>
          {info.etiqueta}
        </Insignia>
      </div>

      {suscripcion.estado === 'fantasma' && (
        <p className={styles.avisoFantasma}>
          Lleva más de 45 días sin uso registrado y sigue cobrando. Si no la vas a usar, cancelarla
          te ahorra {formatearMonto(montoMensual, suscripcion.moneda)} al mes.
        </p>
      )}

      <dl className={styles.grid}>
        <Dato etiqueta="Próximo cobro">
          {/* Cancelada ya no proyecta cobros: igual que en la tarjeta de Inicio. */}
          {cancelada ? (
            'Sin cobros pendientes'
          ) : (
            <>
              {formatearFecha(suscripcion.fecha_proximo_cobro)}
              {dias >= 0 && dias <= 7 && <span className={styles.datoNota}>{cuandoEnDias(dias).toLowerCase()}</span>}
            </>
          )}
        </Dato>
        <Dato etiqueta="Se cobra">{etiquetaFrecuencia(suscripcion.frecuencia)}</Dato>
        <Dato etiqueta="Horas de uso este mes">
          {suscripcion.horas_uso_mes ? formatearHoras(suscripcion.horas_uso_mes) : 'Sin registrar'}
        </Dato>
        <Dato etiqueta="Costo por hora de uso">
          {porHora !== null ? formatearMonto(porHora, suscripcion.moneda) : 'Sin uso este mes'}
        </Dato>
        {suscripcion.fin_prueba && (
          <Dato etiqueta="Termina la prueba gratis">{formatearFecha(suscripcion.fin_prueba)}</Dato>
        )}
      </dl>

      <div className={styles.acciones}>
        {cancelada ? (
          <p className={styles.notaCancelada}>
            La cancelaste: ya no contamos sus próximos cobros. Su historial se conserva.
          </p>
        ) : (
          <Boton variante="secundario" tamano="s" onClick={onCancelar}>
            Cancelar suscripción
          </Boton>
        )}
      </div>
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className={styles.dato}>
      <dt className={styles.datoEtiqueta}>{etiqueta}</dt>
      <dd className={styles.datoValor}>{children}</dd>
    </div>
  );
}
