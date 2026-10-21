import { formatearFechaLarga, formatearMesAnio, nombresDiasSemana, type Moneda } from '@ojoalgasto/shared';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { esDelMes, semanasDelMes, sumarDias, textoCobros } from '../../utils/calendario';
import styles from './Calendario.module.css';

/**
 * Un cobro ubicado en un día. Es el contrato visual del calendario: hoy lo
 * arma la página con el próximo cobro de cada suscripción; CH-18 lo llenará
 * con el rango mensual de VI-07 (cobros previstos y confirmados).
 */
export interface EventoCalendario {
  id: string;
  /** Día del cobro, "YYYY-MM-DD" en fecha local de negocio. */
  fecha: string;
  /** El servicio: Netflix, Spotify… */
  titulo: string;
  monto: number;
  moneda: Moneda;
  /** Para enlazar al detalle de la suscripción. */
  suscripcionId: string;
}

interface CuadriculaMesProps {
  /** Mes a dibujar (`mes` de 0 a 11). CH-19 los cambia para navegar. */
  anio: number;
  mes: number;
  /** Hoy, "YYYY-MM-DD": se marca con aria-current="date". */
  hoy: string;
  /** Día elegido, o null si ninguno. */
  seleccionado: string | null;
  onSeleccionar: (iso: string) => void;
  eventos: EventoCalendario[];
}

// Teclas de la cuadrícula (patrón grid de WAI-ARIA): flechas = ±1 día o ±1
// semana; Inicio/Fin = lunes/domingo de esa semana.
const DESPLAZAMIENTO: Partial<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/**
 * Cuadrícula mensual accesible (CH-17): semanas de lunes a domingo, cada día
 * es un botón con su fecha completa y cuántos cobros tiene. Con el teclado
 * se recorre con flechas (un solo día es tabulable a la vez) y se elige con
 * Enter o Espacio. Por ahora el foco no sale del mes: cruzar de mes es
 * navegación y la agrega CH-19.
 */
export function CuadriculaMes({ anio, mes, hoy, seleccionado, onSeleccionar, eventos }: CuadriculaMesProps) {
  const semanas = useMemo(() => semanasDelMes(anio, mes), [anio, mes]);
  const cortos = useMemo(() => nombresDiasSemana('short'), []);
  const largos = useMemo(() => nombresDiasSemana('long'), []);

  const cobrosPorDia = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const e of eventos) conteo.set(e.fecha, (conteo.get(e.fecha) ?? 0) + 1);
    return conteo;
  }, [eventos]);

  const dias = useMemo(() => semanas.flat().filter((d): d is string => d !== null), [semanas]);
  // El único día que recibe Tab (tabindex móvil): el último recorrido con
  // el teclado; si no, el elegido; si no, hoy; si no, el 1. Siempre de este mes.
  const [enfocado, setEnfocado] = useState<string | null>(null);
  const porDefecto = [seleccionado, hoy].find((d) => d !== null && esDelMes(d, anio, mes)) ?? dias[0];
  const diaEnfocado = enfocado !== null && esDelMes(enfocado, anio, mes) ? enfocado : porDefecto;
  const cuadricula = useRef<HTMLTableElement>(null);
  const moverFoco = useRef(false);

  // Solo se mueve el foco después de una tecla (no al montar ni al recibir datos).
  useEffect(() => {
    if (!moverFoco.current) return;
    moverFoco.current = false;
    cuadricula.current?.querySelector<HTMLButtonElement>(`button[data-fecha="${diaEnfocado}"]`)?.focus();
  }, [diaEnfocado]);

  function alTeclear(e: KeyboardEvent<HTMLButtonElement>, iso: string) {
    // Inicio/Fin van al primer/último día de esta semana que sea del mes.
    const semana = (semanas.find((s) => s.includes(iso)) ?? []).filter((d): d is string => d !== null);
    const salto = DESPLAZAMIENTO[e.key];
    let destino: string | undefined;
    if (salto !== undefined) destino = sumarDias(iso, salto);
    else if (e.key === 'Home') destino = semana[0];
    else if (e.key === 'End') destino = semana[semana.length - 1];
    else return; // Enter, Espacio y Tab hacen lo de siempre

    e.preventDefault();
    if (!destino || !esDelMes(destino, anio, mes)) return;
    moverFoco.current = true;
    setEnfocado(destino);
  }

  return (
    <table ref={cuadricula} role="grid" aria-label={formatearMesAnio(anio, mes)} className={styles.cuadricula}>
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
              const cantidad = cobrosPorDia.get(iso) ?? 0;
              const esHoy = iso === hoy;
              const elegido = iso === seleccionado;
              return (
                <td key={iso} role="gridcell" aria-selected={elegido}>
                  <button
                    type="button"
                    data-fecha={iso}
                    tabIndex={iso === diaEnfocado ? 0 : -1}
                    aria-label={`${formatearFechaLarga(iso)}, ${textoCobros(cantidad)}`}
                    aria-current={esHoy ? 'date' : undefined}
                    className={[styles.dia, esHoy ? styles.hoy : '', elegido ? styles.elegido : ''].join(' ')}
                    onClick={() => {
                      setEnfocado(iso);
                      onSeleccionar(iso);
                    }}
                    onKeyDown={(e) => alTeclear(e, iso)}
                  >
                    <span className={styles.numero}>{Number(iso.slice(8))}</span>
                    {cantidad > 0 && (
                      <span className={styles.marca} aria-hidden="true">
                        {cantidad}
                      </span>
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
