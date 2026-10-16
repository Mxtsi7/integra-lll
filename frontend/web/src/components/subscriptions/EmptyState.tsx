import React from "react";
import { Plus } from "lucide-react";
import { OjoMarca } from "../layout/Marca";
import { Boton } from "../ui/Boton";
import styles from "./EmptyState.module.css";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** Texto del botón de acción. Si no se pasa (o falta onAction), no se muestra botón. */
  actionLabel?: string;
  onAction?: () => void;
  icon?: React.ReactNode;
  className?: string;
}

/**
 * Pantalla de "todavía no hay nada". Es una invitación a actuar, no un
 * error: dice qué pasa cuando agregas la primera.
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
    <section className={`${styles.tarjeta} ${className}`}>
      <div className={styles.icono}>{icon ?? <OjoMarca tamano={56} />}</div>
      <h2 className={styles.titulo}>{title}</h2>
      {description && <p className={styles.descripcion}>{description}</p>}
      {actionLabel && onAction && (
        <Boton onClick={onAction} icono={<Plus size={16} aria-hidden="true" />}>
          {actionLabel}
        </Boton>
      )}
    </section>
  );
};

export default EmptyState;
