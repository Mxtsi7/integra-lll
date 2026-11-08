import React, { useId } from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  costoPorHora,
  equivalenteMensual,
  formatearFecha,
  formatearMonto,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { diasHasta } from "../../utils/fechas";
import { Insignia } from "../ui/Insignia";
import { usePresentacionCategoria, cuandoEnDias, ESTADOS, sufijoFrecuencia, tieneAlerta } from "./presentacion";
import styles from "./TarjetaSuscripcion.module.css";

interface TarjetaSuscripcionProps {
  /** El dato del dominio, tal como lo entrega la API. */
  suscripcion?: Suscripcion;
  onClick?: (suscripcion: Suscripcion) => void;
  /** Abre el formulario de edición para esta suscripción. */
  onEdit?: (suscripcion: Suscripcion) => void;
  /** Abre el diálogo de confirmación para eliminar esta suscripción. */
  onDelete?: (suscripcion: Suscripcion) => void;
  /**
   * Pide prender o apagar el seguimiento de sus cobros: el padre confirma y
   * llama a cancelar o reactivar. Sin ella, el estado se ve como insignia.
   */
  onCambiarSeguimiento?: (suscripcion: Suscripcion) => void;
  /** true mientras se cancela o reactiva: muestra "Guardando…" y bloquea sus acciones. */
  isChangingState?: boolean;
  isLoading?: boolean;
  /** true mientras se reproduce el fade-out justo antes de quitarla de la lista. */
  isRemoving?: boolean;
}

function textoProximoCobro(s: Suscripcion): string {
  if (s.estado === "cancelado") return "Sin cobros pendientes";
  const dias = diasHasta(s.fecha_proximo_cobro);
  if (dias >= 0 && dias <= 7) return `Se cobra ${cuandoEnDias(dias).toLowerCase()}`;
  return `Próximo cobro ${formatearFecha(s.fecha_proximo_cobro)}`;
}

/**
 * Una suscripción como un dispositivo de la casa: icono de su categoría,
 * un interruptor que dice si seguimos sus cobros, el monto grande abajo.
 *
 * El interruptor es un botón hermano del que abre el detalle, no un hijo:
 * antes era un dibujo dentro de ese botón y pulsarlo abría el detalle.
 */
const TarjetaSuscripcion: React.FC<TarjetaSuscripcionProps> = ({
  suscripcion,
  onClick,
  onEdit,
  onDelete,
  onCambiarSeguimiento,
  isChangingState = false,
  isLoading = false,
  isRemoving = false,
}) => {
  const categoriaVisual = usePresentacionCategoria();
  const idEstado = useId();
  if (isLoading || !suscripcion) {
    return (
      <li className={`tile ${styles.tarjeta} ${styles.cargando}`} aria-hidden="true">
        <span className={`${styles.esqueleto} ${styles.esqueletoIcono}`} />
        <span className={`${styles.esqueleto} ${styles.esqueletoTitulo}`} />
        <span className={`${styles.esqueleto} ${styles.esqueletoLinea}`} />
        <span className={`${styles.esqueleto} ${styles.esqueletoMonto}`} />
      </li>
    );
  }

  const { nombre, monto, moneda, frecuencia, horas_uso_mes, estado, categoria } = suscripcion;
  const { Icono, color, suave, etiqueta: etiquetaCategoria } = categoriaVisual(categoria);
  const montoMensual = equivalenteMensual(monto, frecuencia);
  const porHora = costoPorHora(montoMensual, horas_uso_mes ?? 0);
  const alerta = tieneAlerta(suscripcion);
  const info = ESTADOS[estado];
  // Encendido = la seguimos contando. El dominio tiene cinco estados, no un
  // booleano: solo una cancelada está apagada, y cada una conserva su etiqueta.
  const seguida = estado !== "cancelado";
  const colorEstado = `var(--${info.tono === "neutro" ? "tinta-2" : info.tono})`;

  return (
    <li
      className={`tile ${styles.tarjeta} ${estado === "fantasma" ? styles.fantasma : ""} ${isRemoving ? styles.saliendo : ""}`}
      style={{ "--tinte": suave } as React.CSSProperties}
    >
      <button
        type="button"
        className={styles.cuerpo}
        onClick={onClick ? () => onClick(suscripcion) : undefined}
        aria-label={`Ver ${nombre}`}
      >
        <span className={styles.arriba}>
          <span className={styles.icono} style={{ color }}>
            <Icono size={22} aria-hidden="true" />
          </span>
        </span>

        <span className={styles.nombre}>{nombre}</span>
        <span className={styles.categoria}>{etiquetaCategoria}</span>

        <span className={styles.abajo}>
          <span className={styles.monto}>
            {formatearMonto(monto, moneda)}
            <span className={styles.periodo}>{sufijoFrecuencia(frecuencia)}</span>
          </span>
          <span className={`${styles.detalle} ${alerta ? styles.detalleAlerta : ""}`}>{textoProximoCobro(suscripcion)}</span>
          {porHora !== null && <span className={styles.detalle}>{formatearMonto(porHora, moneda)} por hora de uso</span>}
        </span>
      </button>

      <span className={styles.estado} style={{ color: colorEstado }}>
        {onCambiarSeguimiento ? (
          <>
            {/* aria-disabled y no disabled: mientras se guarda, el foco se
                queda acá en vez de perderse. */}
            <button
              type="button"
              role="switch"
              aria-checked={seguida}
              aria-label={`Seguimiento de cobros de ${nombre}`}
              aria-describedby={idEstado}
              aria-disabled={isChangingState || undefined}
              aria-busy={isChangingState || undefined}
              title={seguida ? "Dejar de seguir sus cobros" : "Volver a seguir sus cobros"}
              className={styles.interruptorBoton}
              onClick={() => {
                if (!isChangingState) onCambiarSeguimiento(suscripcion);
              }}
            >
              <span
                className={`${styles.interruptor} ${seguida ? styles.interruptorEncendido : ""} ${estado === "fantasma" ? styles.interruptorCoral : ""}`}
                aria-hidden="true"
              />
            </button>
            <span id={idEstado}>{isChangingState ? "Guardando…" : info.etiqueta}</span>
          </>
        ) : (
          <Insignia tono={info.tono}>{info.etiqueta}</Insignia>
        )}
      </span>

      <span className={styles.acciones}>
        {onEdit && (
          <button
            type="button"
            className={styles.accion}
            aria-label={`Editar ${nombre}`}
            title="Editar"
            disabled={isChangingState}
            onClick={() => onEdit(suscripcion)}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className={`${styles.accion} ${styles.accionPeligro}`}
            aria-label={`Eliminar ${nombre}`}
            title="Eliminar"
            disabled={isChangingState}
            onClick={() => onDelete(suscripcion)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
        )}
      </span>
    </li>
  );
};

export default TarjetaSuscripcion;
