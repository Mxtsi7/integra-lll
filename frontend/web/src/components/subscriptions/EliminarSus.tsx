import React from "react";
import { Boton } from "../ui/Boton";
import styles from "./EliminarSus.module.css";

interface EliminarSuscripcionDialogProps {
  /** Nombre del servicio a eliminar, ej. "Netflix". Se inserta en el mensaje. */
  nombreSuscripcion: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** true mientras el DELETE está en vuelo: deshabilita ambos botones. */
  isDeleting?: boolean;
  /** Mensaje a mostrar si el DELETE falló. Va dentro del diálogo para que se vea. */
  error?: string | null;
}

/**
 * Cuerpo de la confirmación de eliminar. Se muestra dentro de <Modal
 * tipo="alerta">, que pone el título y evita el cierre accidental.
 */
const EliminarSuscripcionDialog: React.FC<EliminarSuscripcionDialogProps> = ({
  nombreSuscripcion,
  onConfirm,
  onCancel,
  isDeleting = false,
  error = null,
}) => {
  return (
    <div className={styles.cuerpo}>
      <p className={styles.mensaje}>
        Se borra <strong>{nombreSuscripcion}</strong> con su historial de uso. No se puede deshacer.
      </p>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onCancel} disabled={isDeleting}>
          Cancelar
        </Boton>
        <Boton variante="peligro" onClick={onConfirm} cargando={isDeleting}>
          {isDeleting ? "Eliminando…" : "Eliminar"}
        </Boton>
      </div>
    </div>
  );
};

export default EliminarSuscripcionDialog;
