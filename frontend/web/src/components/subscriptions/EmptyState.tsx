import React from "react";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Texto del botón de acción. Si no se pasa (o falta onAction), no se muestra botón. */
  actionLabel?: string;
  onAction?: () => void;
  /** Ícono dentro del círculo. Por defecto, un triángulo de advertencia. */
  icon?: React.ReactNode;
  className?: string;
}

const DefaultIcon: React.FC = () => (
  <svg className={styles.icon} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M12 4.5 2.7 20h18.6L12 4.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M12 10v4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    <circle cx="12" cy="17.3" r="0.9" fill="currentColor" />
  </svg>
);

/**
 * EmptyState
 *
 * Tarjeta de "no hay datos": ícono + título + descripción + botón de acción.
 * Genérica a propósito, para reutilizarla en otras páginas (calendario de
 * pagos, informes, cuentas conectadas...) cambiando solo los textos.
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  actionLabel,
  onAction,
  icon,
  className = "",
}) => {
  return (
    <section className={`${styles.card} ${className}`}>
      <div className={styles.iconCircle}>{icon ?? <DefaultIcon />}</div>

      <h2 className={styles.title}>{title}</h2>

      {description && <p className={styles.description}>{description}</p>}

      {actionLabel && onAction && (
        <button type="button" className={styles.actionButton} onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </section>
  );
};

export default EmptyState;