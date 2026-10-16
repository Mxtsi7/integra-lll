import React from "react";
import { Pencil, Trash2 } from "lucide-react";
import {
  costoPorHora,
  equivalenteMensual,
  formatearFecha,
  formatearMonto,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { diasHasta } from "../../utils/fechas";
import { CATEGORIA_VISUAL, cuandoEnDias, ESTADOS, sufijoFrecuencia, tieneAlerta } from "./presentacion";
import styles from "./TarjetaSuscripcion.module.css";

interface TarjetaSuscripcionProps {
  /** El dato del dominio, tal como lo entrega la API. */
  suscripcion?: Suscripcion;
  onClick?: (suscripcion: Suscripcion) => void;
  /** Abre el formulario de edición para esta suscripción. */
  onEdit?: (suscripcion: Suscripcion) => void;
  /** Abre el diálogo de confirmación para eliminar esta suscripción. */
  onDelete?: (suscripcion: Suscripcion) => void;
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
 * un interruptor que dice si sigue cobrando, el monto grande abajo.
 */
const TarjetaSuscripcion: React.FC<TarjetaSuscripcionProps> = ({
  suscripcion,
  onClick,
  onEdit,
  onDelete,
  isLoading = false,
  isRemoving = false,
}) => {
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
  const { Icono, color, suave, etiqueta: etiquetaCategoria } = CATEGORIA_VISUAL[categoria];
  const montoMensual = equivalenteMensual(monto, frecuencia);
  const porHora = costoPorHora(montoMensual, horas_uso_mes ?? 0);
  const alerta = tieneAlerta(suscripcion);
  const info = ESTADOS[estado];
  const cobrando = estado === "activo" || estado === "fantasma";

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
          <span className={styles.estado} style={{ color: `var(--${info.tono === "neutro" ? "tinta-2" : info.tono})` }}>
            <span className={`${styles.interruptor} ${cobrando ? styles.interruptorEncendido : ""} ${estado === "fantasma" ? styles.interruptorCoral : ""}`} aria-hidden="true" />
            {info.etiqueta}
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

      <span className={styles.acciones}>
        {onEdit && (
          <button
            type="button"
            className={styles.accion}
            aria-label={`Editar ${nombre}`}
            title="Editar"
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
