import React from "react";
import ListCard from "./suscard";
import styles from "./suscard.module.css";
import {
  formatearFecha,
  formatearMonto,
  type Suscripcion,
} from "@ojoalgasto/shared";
import {
  colorDe,
  etiquetaFrecuencia,
  inicialDe,
  tieneAlerta,
} from "./presentacion";

interface SubscriptionItemProps {
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

const AlertIcon: React.FC = () => (
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" style={{ width: 12, height: 12 }}>
    <path d="M10 2.5 1.8 16.5h16.4L10 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path d="M10 8v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <circle cx="10" cy="13.6" r="0.9" fill="currentColor" />
  </svg>
);

const EditIcon: React.FC = () => (
  <svg className={styles.editIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M13.4 3.6a1.4 1.4 0 0 1 2 2L6.8 15.2l-3 .8.8-3L13.4 3.6Z"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
    />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg className={styles.editIcon} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M4 6h12M8 6V4.5A1 1 0 0 1 9 3.5h2A1 1 0 0 1 12 4.5V6M6 6l.6 9.2A1.5 1.5 0 0 0 8.1 16.6h3.8a1.5 1.5 0 0 0 1.5-1.4L14 6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const SubscriptionItem: React.FC<SubscriptionItemProps> = ({
  suscripcion,
  onClick,
  onEdit,
  onDelete,
  isLoading = false,
  isRemoving = false,
}) => {
  // El esqueleto no dibuja datos, así que no necesita una suscripción.
  if (isLoading || !suscripcion) {
    return <ListCard title="" isLoading />;
  }

  const { nombre, monto, moneda, frecuencia, fecha_proximo_cobro } = suscripcion;

  return (
    <ListCard
      isRemoving={isRemoving}
      leading={
        <span
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            fontWeight: 700,
            fontSize: 16,
            backgroundColor: colorDe(nombre),
          }}
        >
          {inicialDe(nombre)}
        </span>
      }
      title={nombre}
      subtitle={etiquetaFrecuencia(frecuencia)}
      badge={
        tieneAlerta(suscripcion)
          ? { label: "Alerta", tone: "warning", icon: <AlertIcon /> }
          : undefined
      }
      trailing={
        <>
          {formatearMonto(monto, moneda)}
          {/* El sufijo sale de la frecuencia: antes decía "/mes" siempre, así
              que una suscripción anual mostraba su monto anual como si fuera
              mensual. */}
          <span style={{ fontWeight: 500, color: "var(--list-card-muted, #8990a3)", marginLeft: 2 }}>
            {frecuencia === "anual" ? "/año" : "/mes"}
          </span>
        </>
      }
      trailingSubtext={`Próximo cobro: ${formatearFecha(fecha_proximo_cobro)}`}
      onClick={onClick ? () => onClick(suscripcion) : undefined}
      actions={
        <>
          {onEdit && (
            <button
              type="button"
              className={`${styles.editButton} ${styles.actionEdit}`}
              aria-label={`Editar ${nombre}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(suscripcion);
              }}
            >
              <EditIcon />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={`${styles.editButton} ${styles.actionDelete}`}
              aria-label={`Eliminar ${nombre}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(suscripcion);
              }}
            >
              <TrashIcon />
            </button>
          )}
        </>
      }
    />
  );
};

export default SubscriptionItem;
