import React from "react";
import { Boton } from "../ui/Boton";
// Mismo cuerpo que la confirmación de eliminar: mensaje, error y dos botones.
import styles from "./EliminarSus.module.css";

interface CancelarSuscripcionDialogProps {
  /** Nombre del servicio a cancelar, ej. "Netflix". Se inserta en el mensaje. */
  nombreSuscripcion: string;
  onConfirm: () => void;
  /** Cerrar sin cancelar: no se llama a la API ni cambia nada. */
  onVolver: () => void;
  /** true mientras la cancelación está en vuelo: deshabilita ambos botones. */
  isCancelling?: boolean;
  /** Mensaje a mostrar si la cancelación falló. Va dentro del diálogo para que se vea. */
  error?: string | null;
}

/**
 * Cuerpo de la confirmación de cancelar (CH-10). Se muestra dentro de
 * <Modal tipo="alerta">, que pone el título y evita el cierre accidental.
 * La usan el detalle y el interruptor de las tarjetas de Inicio.
 *
 * Cancelar no es eliminar: explica qué se conserva y qué deja de pasar, y
 * el botón para cerrar dice "Volver" (no "Cancelar") para no confundirlo
 * con la acción.
 */
const CancelarSuscripcionDialog: React.FC<CancelarSuscripcionDialogProps> = ({
  nombreSuscripcion,
  onConfirm,
  onVolver,
  isCancelling = false,
  error = null,
}) => {
  return (
    <div className={styles.cuerpo}>
      <p className={styles.mensaje}>
        Dejamos de contar los próximos cobros de <strong>{nombreSuscripcion}</strong> en tu gasto y en el
        calendario. Su historial de cobros y de uso se conserva.
      </p>
      <p className={styles.mensaje}>Esto no la elimina: si quieres sacarla de tu lista, usa Eliminar.</p>
      {/* Lo que se cambia acá es el seguimiento en Ojo al Gasto: el cobro real
          solo se detiene en el proveedor. */}
      <p className={styles.mensaje}>
        Esto solo cambia el seguimiento en Ojo al Gasto. Para que dejen de cobrarte, cancela el servicio con su
        proveedor.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onVolver} disabled={isCancelling}>
          Volver
        </Boton>
        <Boton variante="peligro" onClick={onConfirm} cargando={isCancelling}>
          {isCancelling ? "Cancelando…" : "Cancelar suscripción"}
        </Boton>
      </div>
    </div>
  );
};

export default CancelarSuscripcionDialog;
