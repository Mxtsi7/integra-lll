import { useState } from "react";
import { etiquetaDelPeriodo, formatearFecha, type RegistroUso } from "@ojoalgasto/shared";
import { Boton } from "../ui/Boton";
import { CampoSelect } from "../ui/Campo";
import { Spinner } from "../Spinner";
import styles from "./UsoSuscripcion.module.css";

export type EstadoHistorial =
  | { tipo: "cargando" }
  | { tipo: "error" }
  | { tipo: "listo"; usos: RegistroUso[] };

interface HistorialUsoProps {
  estado: EstadoHistorial;
  onReintentar: () => void;
}

/** Valor del selector cuando se ven todos los registros. */
const TODO_EL_HISTORIAL = "";

function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/** Los meses ("YYYY-MM") que tienen registros, del más reciente al más antiguo. */
function mesesConRegistros(usos: RegistroUso[]): string[] {
  return Array.from(new Set(usos.map((uso) => uso.fecha.slice(0, 7)))).sort().reverse();
}

/**
 * Historial de uso de la suscripción (CH-15) y su filtro por período (S3-CH-18).
 * Muestra los registros en el mismo orden en que los manda el backend (del más reciente al
 * más antiguo) y con sus valores tal cual, sin agruparlos ni recalcularlos. El período solo
 * ofrece los meses con registros: un mes sin uso no aparece como cero.
 */
export function HistorialUso({ estado, onReintentar }: HistorialUsoProps) {
  const [mes, setMes] = useState(TODO_EL_HISTORIAL);

  if (estado.tipo === "cargando") {
    return (
      <p className={styles.estadoLista}>
        <Spinner size={14} decorativo /> Cargando el historial…
      </p>
    );
  }

  if (estado.tipo === "error") {
    return (
      <div className={styles.estadoLista} role="alert">
        <p>No pudimos cargar el historial de uso.</p>
        <Boton variante="secundario" tamano="s" onClick={onReintentar}>
          Reintentar
        </Boton>
      </div>
    );
  }

  if (estado.usos.length === 0) {
    return <p className={styles.estadoLista}>Todavía no registras uso de esta suscripción.</p>;
  }

  const meses = mesesConRegistros(estado.usos);
  // Si el mes elegido ya no tiene registros (la lista cambió), se vuelve a ver todo.
  const elegido = meses.includes(mes) ? mes : TODO_EL_HISTORIAL;
  const usos =
    elegido === TODO_EL_HISTORIAL ? estado.usos : estado.usos.filter((uso) => uso.fecha.startsWith(`${elegido}-`));

  return (
    <>
      <CampoSelect
        etiqueta="Período"
        className={styles.periodo}
        value={elegido}
        onChange={(evento) => setMes(evento.target.value)}
      >
        <option value={TODO_EL_HISTORIAL}>Todo el historial</option>
        {meses.map((opcion) => (
          <option key={opcion} value={opcion}>
            {etiquetaDelPeriodo(opcion)}
          </option>
        ))}
      </CampoSelect>
      <ol className={styles.lista} aria-label="Historial de uso">
        {usos.map((uso, indice) => (
          // El backend no manda id por registro y puede haber dos el mismo día.
          <li key={`${uso.fecha}-${indice}`} className={styles.fila}>
            <time dateTime={uso.fecha} className={styles.filaFecha}>
              {formatearFecha(uso.fecha)}
            </time>
            <span className={styles.filaMinutos}>{duracion(uso.minutos)}</span>
          </li>
        ))}
      </ol>
    </>
  );
}

export default HistorialUso;
