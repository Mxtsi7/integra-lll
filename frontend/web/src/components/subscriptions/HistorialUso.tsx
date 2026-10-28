import { formatearFecha, type RegistroUso } from "@ojoalgasto/shared";
import { Boton } from "../ui/Boton";
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

function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return resto === 0 ? `${horas} h` : `${horas} h ${resto} min`;
}

/**
 * Historial de uso de la suscripción (CH-15). Muestra los registros en el
 * mismo orden en que los manda el backend (del más reciente al más
 * antiguo) y con sus valores tal cual, sin agruparlos ni recalcularlos.
 */
export function HistorialUso({ estado, onReintentar }: HistorialUsoProps) {
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

  return (
    <ol className={styles.lista} aria-label="Historial de uso">
      {estado.usos.map((uso, i) => (
        // El backend no manda id por registro y puede haber dos el mismo día.
        <li key={`${uso.fecha}-${i}`} className={styles.fila}>
          <time dateTime={uso.fecha} className={styles.filaFecha}>
            {formatearFecha(uso.fecha)}
          </time>
          <span className={styles.filaMinutos}>{duracion(uso.minutos)}</span>
        </li>
      ))}
    </ol>
  );
}

export default HistorialUso;
