import React from "react";
import styles from "./suscard.module.css";

export interface ListCardBadge {
  label: string;
  tone?: "warning" | "danger" | "success" | "neutral";
  icon?: React.ReactNode;
}

export interface ListCardProps {
  leading?: React.ReactNode;
  title: React.ReactNode;
  badge?: ListCardBadge;
  subtitle?: React.ReactNode;
  trailing?: React.ReactNode;
  trailingSubtext?: React.ReactNode;
  showChevron?: boolean;
  onClick?: () => void;
  /** Botones u otras acciones (editar, eliminar) fuera del área clicable. */
  actions?: React.ReactNode;
  isLoading?: boolean;
  /** Activa la animación de fade-out (usado justo antes de eliminar). */
  isRemoving?: boolean;
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
    <path d="M7.5 4.5 13 10l-5.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const ListCard: React.FC<ListCardProps> = ({
  leading,
  title,
  badge,
  subtitle,
  trailing,
  trailingSubtext,
  showChevron = true,
  onClick,
  actions,
  isLoading = false,
  isRemoving = false,
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
      {leading && <span className={styles.leading} aria-hidden="true">{leading}</span>}

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
          {trailingSubtext && <span className={styles.trailingSubtext}>{trailingSubtext}</span>}
        </span>
      )}
    </>
  );

  return (
    <li
      className={`${styles.listCard} ${isRemoving ? styles.removing : ""} ${className}`}
    >
      <div className={styles.rowWrapper}>
        {onClick ? (
          <button type="button" className={`${styles.row} ${styles.rowButton}`} onClick={onClick}>
            {content}
          </button>
        ) : (
          <div className={styles.row}>{content}</div>
        )}

        {(actions || (showChevron && onClick)) && (
          <span className={styles.trailingActions}>
            {actions}
            {showChevron && onClick && <ChevronIcon />}
          </span>
        )}
      </div>
    </li>
  );
};

export default ListCard;