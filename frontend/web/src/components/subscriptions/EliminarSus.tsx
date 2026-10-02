import React from "react";
import styles from "./EliminarSus.module.css";

interface EliminarSuscripcionDialogProps {
  /** Nombre del servicio a eliminar, ej. "Netflix". Se inserta en el mensaje. */
  nombreSuscripcion: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** true mientras el DELETE está en vuelo: deshabilita ambos botones. */
  isDeleting?: boolean;
}

const WarningIcon: React.FC = () => (
  <svg className={styles.warningIcon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 4.5 2.7 20h18.6L12 4.5Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path d="M12 10v4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="17.3" r="1" fill="currentColor" />
  </svg>
);

/**
 * EliminarSuscripcionDialog
 *
 * Tarjeta de confirmación (sin overlay propio) para una acción destructiva.
 * El componente que la use debe envolverla en su propio fondo/overlay
 * (por ejemplo, reutilizando `formOverlay` de Homepage.module.css).
 */
const EliminarSuscripcionDialog: React.FC<EliminarSuscripcionDialogProps> = ({
  nombreSuscripcion,
  onConfirm,
  onCancel,
  isDeleting = false,
}) => {
  return (
    <div className={styles.card} role="alertdialog" aria-modal="true">
      <div className={styles.iconCircle}>
        <WarningIcon />
      </div>

      <h2 className={styles.title}>¿Eliminar suscripción?</h2>

      <p className={styles.message}>
        Esta acción no se puede deshacer. Se eliminará el registro de{" "}
        <strong>{nombreSuscripcion}</strong> y todo su historial de pagos.
      </p>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
          disabled={isDeleting}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={styles.deleteButton}
          onClick={onConfirm}
          disabled={isDeleting}
        >
          {isDeleting ? "Eliminando..." : "Eliminar"}
        </button>
      </div>
    </div>
  );
};

export default EliminarSuscripcionDialog;