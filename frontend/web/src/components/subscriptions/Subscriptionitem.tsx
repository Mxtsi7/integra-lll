import React from "react";
import ListCard from "./suscard";
import styles from "./suscard.module.css";
import { formatearMonto, type Moneda } from '@ojoalgasto/shared';


export type BillingCycle = "Mensual" | "Anual";

export interface Subscription {
  id: string;
  name: string;
  initial: string;
  color: string;
  cycle: BillingCycle;
  price: number;
  currency?: Moneda;
  nextChargeDate: string;
  hasAlert?: boolean;
}

interface SubscriptionItemProps {
  subscription: Subscription;
  onClick?: (subscription: Subscription) => void;
  /** Abre el formulario de edición para esta suscripción. */
  onEdit?: (subscription: Subscription) => void;
  /** Abre el diálogo de confirmación para eliminar esta suscripción. */
  onDelete?: (subscription: Subscription) => void;
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
  subscription,
  onClick,
  onEdit,
  onDelete,
  isLoading = false,
  isRemoving = false,
}) => {
  if (isLoading) {
    return <ListCard title="" isLoading />;
  }

  const { name, initial, color, cycle, price, currency, nextChargeDate, hasAlert } =
    subscription;

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
            backgroundColor: color,
          }}
        >
          {initial}
        </span>
      }
      title={name}
      subtitle={cycle}
      badge={hasAlert ? { label: "Alerta", tone: "warning", icon: <AlertIcon /> } : undefined}
      trailing={
        <>
          {formatearMonto(price,currency)}
          <span style={{ fontWeight: 500, color: "var(--list-card-muted, #8990a3)", marginLeft: 2 }}>
            /mes
          </span>
        </>
      }
      trailingSubtext={`Próximo cobro: ${nextChargeDate}`}
      onClick={onClick ? () => onClick(subscription) : undefined}
      actions={
        <>
          {onEdit && (
            <button
              type="button"
              className={styles.editButton}
              aria-label={`Editar ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                onEdit(subscription);
              }}
            >
              <EditIcon />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              className={styles.editButton}
              aria-label={`Eliminar ${name}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(subscription);
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