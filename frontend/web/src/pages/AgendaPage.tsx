import { conMayuscula, formatearFechaLarga, formatearMesAnio, type CobroCalendario } from '@ojoalgasto/shared';
import { useMemo, useState } from 'react';
import { ListaCobros, TotalesPorMoneda } from '../components/calendario/ListaCobros';
import { NavegacionMes } from '../components/calendario/NavegacionMes';
import styles from '../components/calendario/Calendario.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia } from '../components/ui/Insignia';
import { useCobrosDelMes } from '../hooks/useCobrosDelMes';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { isoDeFecha, mesDeFecha, partesDeMes } from '../utils/calendario';

/** Agrupa por día, en orden de fecha. Dentro del día se respeta el orden de la API (por servicio). */
function porDia(cobros: CobroCalendario[]): { fecha: string; cobros: CobroCalendario[] }[] {
  const grupos = new Map<string, CobroCalendario[]>();
  // Las fechas "YYYY-MM-DD" se ordenan bien como texto; sort es estable.
  for (const c of [...cobros].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    grupos.set(c.fecha, [...(grupos.get(c.fecha) ?? []), c]);
  }
  return [...grupos].map(([fecha, delDia]) => ({ fecha, cobros: delDia }));
}

/**
 * Agenda de cobros (CH-21): la alternativa en lista al Calendario. Usa el
 * mismo mes de la URL y los mismos datos (useCobrosDelMes, VI-07), así que
 * agenda y calendario muestran exactamente los mismos cobros.
 */
export function AgendaPage() {
  const [hoy] = useState(() => isoDeFecha(new Date()));
  const { mes, irAMes } = useMesEnUrl(hoy);
  const { anio, mes: indiceMes } = partesDeMes(mes);
  const { estado, reintentar } = useCobrosDelMes(mes);
  const grupos = useMemo(() => (estado.tipo === 'listo' ? porDia(estado.cobros) : []), [estado]);

  return (
    <AppLayout headerTitulo="Calendario" headerSubtitulo="Tus cobros confirmados y los que vienen, en una lista.">
      <NavegacionMes mes={mes} vista="agenda" onIrAMes={irAMes} onHoy={() => irAMes(mesDeFecha(hoy))} />

      <section className={`tile ${styles.panelMes}`} aria-busy={estado.tipo === 'cargando'}>
        {estado.tipo === 'cargando' && (
          <div className={styles.estadoCarga}>
            <Spinner size={18} etiqueta="Cargando tus cobros" />
          </div>
        )}
        {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={reintentar} />}

        {estado.tipo === 'listo' && grupos.length === 0 && (
          <p className={styles.mensaje}>No hay cobros en {formatearMesAnio(anio, indiceMes)}.</p>
        )}

        {estado.tipo === 'listo' && grupos.length > 0 && (
          <>
            <TotalesPorMoneda cobros={estado.cobros} etiqueta="Total del mes" />
            <ol className={styles.agenda} aria-label={`Cobros de ${formatearMesAnio(anio, indiceMes)}`}>
              {grupos.map(({ fecha, cobros }) => (
                <li key={fecha} className={styles.agendaDia}>
                  <h3 className={styles.agendaFecha}>
                    {conMayuscula(formatearFechaLarga(fecha))}
                    {fecha === hoy && <Insignia tono="acento">Hoy</Insignia>}
                  </h3>
                  <ListaCobros cobros={cobros} etiqueta={`Cobros del ${formatearFechaLarga(fecha)}`} />
                </li>
              ))}
            </ol>
          </>
        )}
      </section>
    </AppLayout>
  );
}
