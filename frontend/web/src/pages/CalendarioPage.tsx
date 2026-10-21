import { formatearFechaLarga, formatearMesAnio, generaCobro, getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { CalendarDays, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { CuadriculaMes, type EventoCalendario } from '../components/calendario/CuadriculaMes';
import styles from '../components/calendario/Calendario.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { Boton } from '../components/ui/Boton';
import { Seccion } from '../components/ui/Seccion';
import { esDelMes, fechaDeIso, isoDeFecha, textoCobros } from '../utils/calendario';

const MENSAJE_SIN_RED = 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const MENSAJE_ERROR = 'No pudimos cargar tus cobros. Intenta de nuevo.';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; eventos: EventoCalendario[] };

/**
 * Por ahora cada suscripción aporta su próximo cobro (fecha_proximo_cobro),
 * con la misma regla que la proyección del Panel (generaCobro). CH-18 cambia
 * esta fuente por el rango mensual de VI-07 cuando exista.
 */
function eventosDesde(suscripciones: Suscripcion[]): EventoCalendario[] {
  return suscripciones.filter(generaCobro).map((s) => ({
    id: `${s.id}-${s.fecha_proximo_cobro}`,
    fecha: s.fecha_proximo_cobro,
    titulo: s.nombre,
    monto: s.monto,
    moneda: s.moneda,
    suscripcionId: s.id,
  }));
}

const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1);

/**
 * Calendario de pagos (CH-17): el mes actual en una cuadrícula, con los días
 * que tienen cobros marcados y un día elegido. Los datos son los reales de
 * la API; no hay datos de ejemplo salvo que se active USAR_DATOS_DE_EJEMPLO
 * en shared (el mismo interruptor que usa el resto de la web).
 */
export function CalendarioPage() {
  // "Hoy" se fija al abrir la página. El mes que se ve sale de ahí; CH-19
  // agrega anterior / siguiente / volver a hoy.
  const [hoy] = useState(() => isoDeFecha(new Date()));
  const fechaHoy = fechaDeIso(hoy);
  const anio = fechaHoy.getFullYear();
  const mes = fechaHoy.getMonth();

  const [seleccionado, setSeleccionado] = useState<string>(hoy);
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    getSuscripciones()
      .then((suscripciones) => {
        if (vigente) setEstado({ tipo: 'listo', eventos: eventosDesde(suscripciones) });
      })
      .catch((err: unknown) => {
        if (vigente) setEstado({ tipo: 'error', mensaje: err instanceof TypeError ? MENSAJE_SIN_RED : MENSAJE_ERROR });
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  const eventosDelMes = useMemo(
    () => (estado.tipo === 'listo' ? estado.eventos.filter((e) => esDelMes(e.fecha, anio, mes)) : []),
    [estado, anio, mes],
  );
  const cobrosDelDia = eventosDelMes.filter((e) => e.fecha === seleccionado).length;

  return (
    <AppLayout headerTitulo="Calendario" headerSubtitulo="El próximo cobro de cada suscripción, en su día.">
      <Seccion titulo={conMayuscula(formatearMesAnio(anio, mes))} icono={<CalendarDays size={19} aria-hidden="true" />} tinte="acento">
        {estado.tipo === 'cargando' && (
          <div className={styles.mensaje}>
            <Spinner size={22} etiqueta="Cargando tus cobros" />
          </div>
        )}

        {estado.tipo === 'error' && (
          <div className={styles.errorCaja}>
            <p role="alert">{estado.mensaje}</p>
            <Boton
              variante="secundario"
              tamano="s"
              icono={<RefreshCw size={15} aria-hidden="true" />}
              onClick={() => setIntento((n) => n + 1)}
            >
              Reintentar
            </Boton>
          </div>
        )}

        {estado.tipo === 'listo' && (
          <>
            {eventosDelMes.length === 0 && <p className={styles.mensaje}>No hay cobros este mes.</p>}
            <CuadriculaMes
              anio={anio}
              mes={mes}
              hoy={hoy}
              seleccionado={seleccionado}
              onSeleccionar={setSeleccionado}
              eventos={eventosDelMes}
            />
            {/* CH-20 reemplaza este resumen por el detalle de los cobros del día. */}
            <p className={styles.resumen} aria-live="polite">
              <strong>{conMayuscula(formatearFechaLarga(seleccionado))}</strong>
              {' · '}
              {conMayuscula(textoCobros(cobrosDelDia))}
            </p>
          </>
        )}
      </Seccion>
    </AppLayout>
  );
}
