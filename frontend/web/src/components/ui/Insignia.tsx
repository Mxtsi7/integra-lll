import type { ReactNode } from 'react';
import styles from './Insignia.module.css';

export type TonoInsignia = 'neutro' | 'verde' | 'acento' | 'coral' | 'turquesa' | 'morado';

interface InsigniaProps {
  tono?: TonoInsignia;
  icono?: ReactNode;
  children: ReactNode;
  className?: string;
}

const CLASE: Record<TonoInsignia, string> = {
  neutro: styles.neutro,
  verde: styles.verde,
  acento: styles.acento,
  coral: styles.coral,
  turquesa: styles.turquesa,
  morado: styles.morado,
};

/** Etiqueta corta de estado. El color dice de qué familia es; el texto, qué pasa. */
export function Insignia({ tono = 'neutro', icono, children, className = '' }: InsigniaProps) {
  return (
    <span className={`${styles.insignia} ${CLASE[tono]} ${className}`}>
      {icono}
      {children}
    </span>
  );
}
