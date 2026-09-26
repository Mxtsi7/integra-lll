import React from "react";
import styles from "./suscard.module.css";
 
export interface ListCardBadge {
  label: string;
  tone?: "warning" | "danger" | "success" | "neutral";
  icon?: React.ReactNode;
}
 
export interface ListCardProps {
  /** Elemento a la izquierda: avatar, ícono, imagen, iniciales, etc. */
  leading?: React.ReactNode;
  /** Título principal de la fila. */
  title: React.ReactNode;
  /** Badge opcional junto al título (ej: "Alerta", "Nuevo", "Vencido"). */
  badge?: ListCardBadge;
  /** Texto secundario debajo del título (ej: "Mensual", "hace 2 días"). */
  subtitle?: React.ReactNode;
  /** Contenido a la derecha: precio, fecha, valor, estado, etc. */
  trailing?: React.ReactNode;
  /** Texto de apoyo debajo del trailing (ej: "Próximo cobro: 02 Nov"). */
  trailingSubtext?: React.ReactNode;
  /** Muestra el chevron indicando que la fila es navegable. */
  showChevron?: boolean;
  /** Handler de click; si no se pasa, la fila no es interactiva. */
  onClick?: () => void;
  /**
   * Estado de carga: cuando es true, la fila se reemplaza por un
   * skeleton placeholder animado, útil mientras llegan datos reales.
   */
  isLoading?: boolean;
  /** className adicional para casos de uso específicos. */
  className?: string;
}
 
const toneClassMap: Record<NonNullable<ListCardBadge["tone"]>, string> = {
  warning: styles.badgeWarning,
  danger: styles.badgeDanger,
  success: styles.badgeSuccess,
  neutral: styles.badgeNeutral,
};
 
const ChevronIcon: React.FC = () => (
  <svg className={styles.chevron} viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M7.5 4.5 13 10l-5.5 5.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
 
/**
 * ListCard
 *
 * Fila de lista genérica y reutilizable: elemento a la izquierda + título
 * (con badge opcional) + subtítulo + contenido a la derecha + chevron.
 *
 * Pensada para cualquier lista de la app (suscripciones, transacciones,
 * contactos, notificaciones, tareas...), no solo para un caso puntual.
 * Incluye un estado `isLoading` que renderiza un skeleton placeholder,
 * para usarse mientras se cargan datos reales desde una API.
 */
const ListCard: React.FC<ListCardProps> = ({
  leading,
  title,
  badge,
  subtitle,
  trailing,
  trailingSubtext,
  showChevron = true,
  onClick,
  isLoading = false,
  className = "",
}) => {
  if (isLoading) {
    return (
      <li className={`${styles.listCard} ${styles.loading} ${className}`}>
        <div className={styles.row} aria-hidden="true">
          <span className={`${styles.skeleton} ${styles.skeletonAvatar}`} />
          <span className={styles.info}>
            <span className={`${styles.skeleton} ${styles.skeletonTitle}`} />
            <span className={`${styles.skeleton} ${styles.skeletonSubtitle}`} />
          </span>
          <span className={styles.amount}>
            <span className={`${styles.skeleton} ${styles.skeletonPrice}`} />
            <span className={`${styles.skeleton} ${styles.skeletonNext}`} />
          </span>
        </div>
      </li>
    );
  }
 
  const content = (
    <>
      {leading && (
        <span className={styles.leading} aria-hidden="true">
          {leading}
        </span>
      )}
 
      <span className={styles.info}>
        <span className={styles.titleRow}>
          <span className={styles.title}>{title}</span>
          {badge && (
            <span className={`${styles.badge} ${toneClassMap[badge.tone ?? "neutral"]}`}>
              {badge.icon}
              {badge.label}
            </span>
          )}
        </span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
 
      {(trailing || trailingSubtext) && (
        <span className={styles.amount}>
          {trailing && <span className={styles.trailing}>{trailing}</span>}
          {trailingSubtext && (
            <span className={styles.trailingSubtext}>{trailingSubtext}</span>
          )}
        </span>
      )}
 
      {showChevron && onClick && <ChevronIcon />}
    </>
  );
 
  return (
    <li className={`${styles.listCard} ${className}`}>
      {onClick ? (
        <button type="button" className={`${styles.row} ${styles.rowButton}`} onClick={onClick}>
          {content}
        </button>
      ) : (
        <div className={styles.row}>{content}</div>
      )}
    </li>
  );
};
 
export default ListCard;
