import { formatearMesAnio } from '@ojoalgasto/shared';
import { useState } from 'react';
import { CuadriculaMes } from '../components/calendario/CuadriculaMes';
import { DetalleDia } from '../components/calendario/DetalleDia';
import { NavegacionMes } from '../components/calendario/NavegacionMes';
import { PRESENTACION_TIPO } from '../components/calendario/presentacion';
import styles from '../components/calendario/Calendario.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { useCobrosDelMes } from '../hooks/useCobrosDelMes';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { esDelMes, isoDeFecha, mesDeFecha, partesDeMes, primerDiaDelMes } from '../utils/calendario';

/**
 * Calendario de pagos.
 *
 * - CH-17: cuadrícula del mes, accesible, con un día elegido.
 * - CH-18: los cobros de VI-07 en su día, confirmados y previstos.
 * - CH-19: anterior / Hoy / siguiente; el mes vive en la URL (?mes=YYYY-MM).
 * - CH-20: detalle del día elegido con total por moneda.
 *
 * Todo sale de GET /api/suscripciones/calendario-cobros/; no hay datos en el código.
 */
export function CalendarioPage() {
  // "Hoy" se fija al abrir la página.
  const [hoy] = useState(() => isoDeFecha(new Date()));
  const { mes, irAMes } = useMesEnUrl(hoy);
  const { anio, mes: indiceMes } = partesDeMes(mes);
  const { estado, reintentar } = useCobrosDelMes(mes);

  // El día elegido. Si se navegó a otro mes, se muestra hoy (si es de ese
  // mes) o el día 1: el detalle siempre es de un día que está a la vista.
  const [elegido, setElegido] = useState(hoy);
  const seleccionado = [elegido, hoy].find((d) => esDelMes(d, anio, indiceMes)) ?? primerDiaDelMes(mes);

  const cobros = estado.tipo === 'listo' ? estado.cobros : null;
  const cobrosDelDia = cobros?.filter((c) => c.fecha === seleccionado) ?? null;

  function irAHoy() {
    setElegido(hoy);
    irAMes(mesDeFecha(hoy));
  }

  return (
    <AppLayout headerTitulo="Calendario" headerSubtitulo="Tus cobros confirmados y los que vienen, día por día.">
      <NavegacionMes mes={mes} vista="mes" onIrAMes={irAMes} onHoy={irAHoy} />

      <div className={styles.disposicion}>
        <div className={`tile ${styles.panelMes}`}>
          {estado.tipo === 'cargando' && (
            <div className={styles.estadoCarga}>
              <Spinner size={18} etiqueta="Cargando tus cobros" />
            </div>
          )}
          {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={reintentar} />}
          {estado.tipo === 'listo' && estado.cobros.length === 0 && (
            <p className={styles.mensaje}>No hay cobros en {formatearMesAnio(anio, indiceMes)}.</p>
          )}

          {/* La cuadrícula queda a la vista mientras carga: al cruzar de mes
              con el teclado el foco no se pierde. */}
          <CuadriculaMes
            anio={anio}
            mes={indiceMes}
            hoy={hoy}
            seleccionado={seleccionado}
            onSeleccionar={setElegido}
            cobros={cobros}
            onCambiarMes={(destino) => irAMes(mesDeFecha(destino))}
          />

          <p className={styles.leyenda} aria-hidden="true">
            {Object.entries(PRESENTACION_TIPO).map(([tipo, { etiqueta }]) => (
              <span key={tipo} className={styles.leyendaItem} data-tipo={tipo}>
                {etiqueta}
              </span>
            ))}
          </p>
        </div>

        <DetalleDia fecha={seleccionado} cobros={cobrosDelDia} error={estado.tipo === 'error'} />
      </div>
    </AppLayout>
  );
}
