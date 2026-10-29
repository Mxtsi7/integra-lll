import {
  cambiosDePreferencias,
  ErrorDeApi,
  formatearFechaHora,
  getPreferenciasAlertas,
  guardarPreferenciasAlertas,
  preferenciasEditables,
  type CanalAviso,
  type PreferenciasAlertas,
  type PreferenciasEditables,
} from '@ojoalgasto/shared';
import { Bell } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import AvisoCambiosSinGuardar from '../subscriptions/AvisoCambiosSinGuardar';
import { Boton } from '../ui/Boton';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { Fila, Seccion } from '../ui/Seccion';
import { useToast } from '../../context/ToastContext';
import { useAvisoAlSalir } from '../../hooks/useAvisoAlSalir';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import styles from './PreferenciasAvisos.module.css';

type ClaveInterruptor = Exclude<keyof PreferenciasEditables, 'dias_anticipacion'>;

/** Por dónde se avisa. El canal es el nombre que usa el backend en `canales_disponibles`. */
const CANALES: { clave: ClaveInterruptor; canal: CanalAviso; etiqueta: string; detalle: string }[] = [
  { clave: 'por_email', canal: 'email', etiqueta: 'Por correo', detalle: 'A la dirección de tu cuenta.' },
  { clave: 'por_push', canal: 'push', etiqueta: 'Notificaciones push', detalle: 'En tu teléfono.' },
  { clave: 'en_la_app', canal: 'in_app', etiqueta: 'Dentro de la app', detalle: 'En tus alertas de Ojo al Gasto.' },
];

/** De qué se avisa: uno por cada tipo de alerta de FE-21. */
const TIPOS: { clave: ClaveInterruptor; etiqueta: string; detalle: (dias: number) => string }[] = [
  {
    clave: 'avisar_proximo_cobro',
    etiqueta: 'Antes de cada cobro',
    detalle: (dias) => (dias === 1 ? '1 día antes del cobro.' : `${dias} días antes del cobro.`),
  },
  { clave: 'avisar_fin_prueba', etiqueta: 'Cuando termina una prueba gratis', detalle: () => 'Antes de que empiece a cobrar.' },
  { clave: 'avisar_alza_tarifa', etiqueta: 'Alza de tarifa', detalle: () => 'Cuando una suscripción sube de precio.' },
  { clave: 'avisar_doble_cobro', etiqueta: 'Posible doble cobro', detalle: () => 'Cuando parece que te cobraron dos veces lo mismo.' },
  {
    clave: 'avisar_presupuesto_excedido',
    etiqueta: 'Presupuesto excedido',
    detalle: () => 'Cuando el gasto del mes supera tu presupuesto.',
  },
];

const MENSAJE_ERROR_CARGA = 'No pudimos cargar tus avisos. Intenta de nuevo.';

/** Qué decir si el PATCH falló. Lo editado se conserva: no se guardó nada (FE-21 es todo o nada). */
function mensajeErrorGuardado(err: unknown): string {
  if (err instanceof TypeError) return MENSAJE_SIN_RED;
  if (err instanceof ErrorDeApi && err.status === 400 && err.message) return `No se guardó: ${err.message}`;
  return 'No pudimos guardar tus cambios. Siguen aquí: intenta de nuevo.';
}

type Carga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; guardadas: PreferenciasAlertas };

/**
 * Avisos de Configuración (CH-30), conectados a GET/PATCH
 * /api/preferencias-alertas/ (FE-21). Se edita y después se guarda: el PATCH
 * lleva solo lo que cambió, y mientras no se guarda se dice que hay cambios
 * pendientes. Si falla, lo editado se queda en pantalla para reintentar.
 */
export function PreferenciasAvisos() {
  const toast = useToast();
  const [carga, setCarga] = useState<Carga>({ tipo: 'cargando' });
  const [editadas, setEditadas] = useState<PreferenciasEditables | null>(null);
  const [intento, setIntento] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [errorGuardado, setErrorGuardado] = useState<string | null>(null);
  // Ref y no solo estado: dos clics en el mismo instante verían el estado viejo.
  const guardandoRef = useRef(false);
  const montado = useRef(true);
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  useEffect(() => {
    let vigente = true;
    setCarga({ tipo: 'cargando' });
    getPreferenciasAlertas()
      .then((guardadas) => {
        if (!vigente) return;
        setCarga({ tipo: 'listo', guardadas });
        setEditadas(preferenciasEditables(guardadas));
      })
      .catch((err: unknown) => {
        if (vigente) setCarga({ tipo: 'error', mensaje: err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR_CARGA });
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  const cambios = carga.tipo === 'listo' && editadas ? cambiosDePreferencias(carga.guardadas, editadas) : {};
  const hayCambios = Object.keys(cambios).length > 0;

  // Cambios sin guardar (como CH-16): cerrar o recargar la pestaña lo pregunta
  // el navegador, y navegar dentro de la app queda retenido hasta elegir.
  const hayCambiosRef = useRef(false);
  useEffect(() => {
    hayCambiosRef.current = hayCambios;
  }, [hayCambios]);
  useAvisoAlSalir(hayCambiosRef);
  const navegacion = useBlocker(
    ({ currentLocation, nextLocation }) => hayCambiosRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  // guardar() termina varios renders después: lee el bloqueo desde acá.
  const navegacionActual = useRef(navegacion);
  useEffect(() => {
    navegacionActual.current = navegacion;
  });

  const cambiar = (clave: ClaveInterruptor, valor: boolean) => {
    setEditadas((e) => (e ? { ...e, [clave]: valor } : e));
    setErrorGuardado(null);
  };

  const descartar = () => {
    if (carga.tipo === 'listo') setEditadas(preferenciasEditables(carga.guardadas));
    setErrorGuardado(null);
  };

  const guardar = async () => {
    if (carga.tipo !== 'listo' || !editadas || guardandoRef.current) return;
    const enviar = cambiosDePreferencias(carga.guardadas, editadas);
    if (Object.keys(enviar).length === 0) return;
    guardandoRef.current = true;
    setGuardando(true);
    setErrorGuardado(null);
    try {
      const guardadas = await guardarPreferenciasAlertas(enviar);
      if (!montado.current) return;
      // Lo confirmado por el servidor es lo que queda. Mientras viajaba no se
      // podía editar, así que no hay nada nuevo que se pierda.
      hayCambiosRef.current = false;
      setCarga({ tipo: 'listo', guardadas });
      setEditadas(preferenciasEditables(guardadas));
      toast.exito('Guardamos tus avisos.');
      const pendiente = navegacionActual.current;
      if (pendiente.state === 'blocked') pendiente.proceed();
    } catch (err: unknown) {
      if (montado.current) setErrorGuardado(mensajeErrorGuardado(err));
    } finally {
      guardandoRef.current = false;
      if (montado.current) setGuardando(false);
    }
  };

  return (
    <Seccion
      titulo="Avisos"
      descripcion="Elige por dónde y de qué te avisamos."
      icono={<Bell size={19} aria-hidden="true" />}
      tinte="acento"
    >
      {carga.tipo === 'cargando' && <p className={styles.mensaje}>Cargando tus avisos…</p>}
      {carga.tipo === 'error' && <ErrorConReintento mensaje={carga.mensaje} onReintentar={() => setIntento((n) => n + 1)} />}

      {carga.tipo === 'listo' && editadas && (
        <>
          {navegacion.state === 'blocked' && (
            <AvisoCambiosSinGuardar
              onSeguirEditando={() => navegacion.reset()}
              onDescartar={() => {
                hayCambiosRef.current = false;
                descartar();
                navegacion.proceed();
              }}
            />
          )}

          <h3 className={styles.subtitulo} id="avisos-canales">
            Por dónde
          </h3>
          <div role="group" aria-labelledby="avisos-canales">
            {CANALES.map(({ clave, canal, etiqueta, detalle }) => (
              <FilaInterruptor
                key={clave}
                etiqueta={etiqueta}
                // Un canal que el servidor todavía no entrega se puede elegir
                // igual (queda guardado), pero no se promete que llegue.
                detalle={carga.guardadas.canales_disponibles.includes(canal) ? detalle : 'Todavía no lo enviamos. Si lo activas, queda guardado para cuando esté listo.'}
                activo={editadas[clave]}
                deshabilitado={guardando}
                onChange={(valor) => cambiar(clave, valor)}
              />
            ))}
          </div>
          {!editadas.por_email && !editadas.por_push && !editadas.en_la_app && (
            <p className={styles.nota}>Con todos los canales apagados no te llega ningún aviso.</p>
          )}

          <h3 className={styles.subtitulo} id="avisos-tipos">
            De qué
          </h3>
          <div role="group" aria-labelledby="avisos-tipos">
            {TIPOS.map(({ clave, etiqueta, detalle }) => (
              <FilaInterruptor
                key={clave}
                etiqueta={etiqueta}
                detalle={detalle(editadas.dias_anticipacion)}
                activo={editadas[clave]}
                deshabilitado={guardando}
                onChange={(valor) => cambiar(clave, valor)}
              />
            ))}
          </div>

          {errorGuardado && (
            <p className={styles.error} role="alert">
              {errorGuardado}
            </p>
          )}
          <div className={styles.pie}>
            {/* Lo guardado y lo editado no se confunden: se dice cuál es cuál. */}
            <p className={hayCambios ? styles.estadoPendiente : styles.estado} role="status">
              {hayCambios
                ? 'Tienes cambios sin guardar.'
                : `Guardado · ${formatearFechaHora(carga.guardadas.actualizado_en)}`}
            </p>
            <div className={styles.acciones}>
              <Boton variante="sutil" tamano="s" onClick={descartar} disabled={!hayCambios || guardando}>
                Descartar
              </Boton>
              <Boton tamano="s" onClick={guardar} disabled={!hayCambios} cargando={guardando}>
                Guardar cambios
              </Boton>
            </div>
          </div>
        </>
      )}
    </Seccion>
  );
}

function FilaInterruptor({
  etiqueta,
  detalle,
  activo,
  deshabilitado,
  onChange,
}: {
  etiqueta: string;
  detalle: string;
  activo: boolean;
  deshabilitado: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <Fila etiqueta={etiqueta} detalle={detalle}>
      <button
        type="button"
        role="switch"
        aria-checked={activo}
        aria-label={etiqueta}
        disabled={deshabilitado}
        className={activo ? `${styles.interruptor} ${styles.interruptorActivo}` : styles.interruptor}
        onClick={() => onChange(!activo)}
      >
        <span className={styles.interruptorBola} />
      </button>
    </Fila>
  );
}
