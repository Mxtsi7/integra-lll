import { formatearFechaLarga, formatearMesAnio, formatearMonto, nombresDiasSemana, type CobroCalendario } from '@ojoalgasto/shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { esDelMes, semanasDelMes, sumarDias, sumarMesesAFecha, textoCobros } from '../../utils/calendario';
import { describirCobro } from './presentacion';
import styles from './Calendario.module.css';

interface CuadriculaMesProps {
  /** Mes a dibujar (`mes` de 0 a 11). */
  anio: number;
  mes: number;
  /** Hoy, "YYYY-MM-DD": se marca con aria-current="date". */
  hoy: string;
  /** Día elegido, o null si ninguno. */
  seleccionado: string | null;
  onSeleccionar: (iso: string) => void;
  /**
   * Cobros del mes (VI-07). null mientras se cargan: así los días no dicen
   * "sin cobros" cuando todavía no se sabe.
   */
  cobros: CobroCalendario[] | null;
  /** CH-19: el teclado pidió ir a una fecha de otro mes (la página cambia el mes). */
  onCambiarMes?: (fechaDestino: string) => void;
}

// Teclas de la cuadrícula (patrón grid de WAI-ARIA): flechas = ±1 día o ±1
// semana; Inicio/Fin = lunes/domingo de esa semana; RePág/AvPág = ±1 mes.
const DESPLAZAMIENTO: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
const MESES_POR_TECLA: Partial<Record<string, number>> = { PageUp: -1, PageDown: 1 };

// Cuántos cobros caben escritos en una casilla; el resto se resume en "+N más".
const VISIBLES_POR_DIA = 2;

/**
 * Cuadrícula mensual accesible (CH-17) con los cobros en su día (CH-18).
 *
 * Cada día es un botón cuyo nombre accesible dice la fecha completa y sus
 * cobros ("sábado, 24 de octubre de 2026, 2 cobros: Netflix, $9.990,
 * confirmado; …"), así varios cobros el mismo día se pueden escuchar todos
 * aunque en pantalla solo quepan dos. En celular la casilla muestra solo
 * cuántos hay.
 *
 * Teclado: flechas, Inicio/Fin y RePág/AvPág. Si el destino es de otro mes,
 * avisa con onCambiarMes y el foco llega a ese día cuando el mes se dibuja.
 */
export function CuadriculaMes({ anio, mes, hoy, seleccionado, onSeleccionar, cobros, onCambiarMes }: CuadriculaMesProps) {
  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes]);
  const cortos = useMemo(() => nombresDiasSemana('short'), []);
  const largos = useMemo(() => nombresDiasSemana('long'), []);

  const cobrosPorDia = useMemo(() => {
    const porDia = new Map<string, CobroCalendario[]>();
    for (const c of cobros ?? []) porDia.set(c.fecha, [...(porDia.get(c.fecha) ?? []), c]);
    return porDia;
  }, [cobros]);

  const dias = useMemo(() => semanas.flat().filter((d): d is string => d !== null), [semanas]);
  // El único día que recibe Tab (tabindex móvil): el último que tuvo el foco
  // (con flechas, clic o el lector de pantalla); si no, el elegido; si no,
  // hoy; si no, el 1. Siempre de este mes.
  const [enfocado, setEnfocado] = useState<string | null>(null);
  const porDefecto = [seleccionado, hoy].find((d) => d !== null && esDelMes(d, anio, mes)) ?? dias[0];
  const diaEnfocado = enfocado !== null && esDelMes(enfocado, anio, mes) ? enfocado : porDefecto;
  const cuadricula = useRef<HTMLTableElement>(null);
  // Día al que hay que llevar el foco después de una tecla. Se guarda la
  // fecha (no un sí/no) porque al cruzar de mes el botón recién existe
  // cuando la página dibuja el mes nuevo, quizá un render después.
  const focoPendiente = useRef<string | null>(null);

  useEffect(() => {
    const destino = focoPendiente.current;
    if (destino === null || !esDelMes(destino, anio, mes)) return;
    focoPendiente.current = null;
    cuadricula.current?.querySelector<HTMLButtonElement>(`button[data-fecha="${destino}"]`)?.focus();
  }, [diaEnfocado, anio, mes]);

  function alTeclear(e: KeyboardEvent<HTMLButtonElement>, iso: string) {
    // Inicio/Fin van al primer/último día de esta semana que sea del mes.
    const semana = (semanas.find((s) => s.includes(iso)) ?? []).filter((d): d is string => d !== null);
    const salto = DESPLAZAMIENTO[e.key];
    const meses = MESES_POR_TECLA[e.key];
    let destino: string | undefined;
    if (salto !== undefined) destino = sumarDias(iso, salto);
    else if (meses !== undefined) destino = sumarMesesAFecha(iso, meses);
    else if (e.key === 'Home') destino = semana[0];
    else if (e.key === 'End') destino = semana[semana.length - 1];
    else return; // Enter, Espacio y Tab hacen lo de siempre

    e.preventDefault();
    // Sin movimiento (Inicio en el lunes) no queda un foco pendiente que
    // después se robe el foco de otro día.
    if (!destino || destino === iso) return;
    const otroMes = !esDelMes(destino, anio, mes);
    if (otroMes && !onCambiarMes) return; // sin navegación, el foco no sale del mes
    focoPendiente.current = destino;
    setEnfocado(destino);
    if (otroMes) onCambiarMes?.(destino);
  }

  function nombreAccesible(iso: string, delDia: CobroCalendario[]): string {
    const fecha = formatearFechaLarga(iso);
    if (cobros === null) return fecha; // cargando: todavía no se sabe
    if (delDia.length === 0) return `${fecha}, ${textoCobros(0)}`;
    return `${fecha}, ${textoCobros(delDia.length)}: ${delDia.map(describirCobro).join('; ')}`;
  }

  return (
    <table
      ref={cuadricula}
      role="grid"
      aria-label={formatearMesAnio(anio, mes)}
      aria-busy={cobros === null}
      className={styles.cuadricula}
    >
      <thead>
        <tr>
          {cortos.map((corto, i) => (
            <th key={largos[i]} scope="col" abbr={largos[i]} className={styles.diaSemana}>
              {corto}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {semanas.map((semana) => (
          <tr key={semana.find((d) => d !== null)}>
            {semana.map((iso, columna) => {
              if (!iso) return <td key={`vacia-${columna}`} role="gridcell" className={styles.vacia} />;
              const delDia = cobrosPorDia.get(iso) ?? [];
              const esHoy = iso === hoy;
              const elegido = iso === seleccionado;
              return (
                <td key={iso} role="gridcell" aria-selected={elegido}>
                  <button
                    type="button"
                    data-fecha={iso}
                    tabIndex={iso === diaEnfocado ? 0 : -1}
                    aria-label={nombreAccesible(iso, delDia)}
                    aria-current={esHoy ? 'date' : undefined}
                    className={[styles.dia, esHoy ? styles.hoy : '', elegido ? styles.elegido : ''].join(' ')}
                    onFocus={() => setEnfocado(iso)}
                    onClick={() => {
                      setEnfocado(iso); // Safari no enfoca los botones al hacer clic
                      onSeleccionar(iso);
                    }}
                    onKeyDown={(e) => alTeclear(e, iso)}
                  >
                    <span className={styles.numero}>{Number(iso.slice(8))}</span>
                    {delDia.length > 0 && (
                      <>
                        {/* Escritorio: servicio e importe. El nombre accesible ya lo dice todo. */}
                        <span className={styles.cobrosDia} aria-hidden="true">
                          {delDia.slice(0, VISIBLES_POR_DIA).map((c) => (
                            <span key={c.id} className={styles.cobroDia} data-tipo={c.tipo}>
                              <span className={styles.cobroServicio}>{c.servicio}</span>
                              <span className={styles.cobroImporte}>{formatearMonto(c.importe, c.moneda)}</span>
                            </span>
                          ))}
                          {delDia.length > VISIBLES_POR_DIA && (
                            <span className={styles.masCobros}>+{delDia.length - VISIBLES_POR_DIA} más</span>
                          )}
                        </span>
                        {/* Celular: solo cuántos. */}
                        <span className={styles.marca} aria-hidden="true">
                          {delDia.length}
                        </span>
                      </>
                    )}
                  </button>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
