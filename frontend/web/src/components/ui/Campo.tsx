import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId } from 'react';
import styles from './Campo.module.css';

interface Base {
  etiqueta: string;
  /** Texto corto debajo del control: formato esperado, consecuencia, etc. */
  ayuda?: string;
  error?: string;
  /** Icono a la izquierda, dentro del control. */
  icono?: ReactNode;
}

type CampoTextoProps = Base & InputHTMLAttributes<HTMLInputElement>;

export function CampoTexto({ etiqueta, ayuda, error, icono, id, className = '', ...resto }: CampoTextoProps) {
  const generado = useId();
  const idControl = id ?? generado;
  const idAyuda = `${idControl}-ayuda`;
  return (
    <div className={`${styles.campo} ${className}`}>
      <label className={styles.etiqueta} htmlFor={idControl}>
        {etiqueta}
      </label>
      <div className={`${styles.control} ${error ? styles.conError : ''}`}>
        {icono && (
          <span className={styles.icono} aria-hidden="true">
            {icono}
          </span>
        )}
        <input
          id={idControl}
          className={styles.entrada}
          aria-invalid={error ? true : undefined}
          aria-describedby={ayuda || error ? idAyuda : undefined}
          {...resto}
        />
      </div>
      {(error || ayuda) && (
        <p id={idAyuda} className={error ? styles.error : styles.ayuda}>
          {error ?? ayuda}
        </p>
      )}
    </div>
  );
}

type CampoSelectProps = Base & SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode };

export function CampoSelect({ etiqueta, ayuda, error, id, className = '', children, ...resto }: CampoSelectProps) {
  const generado = useId();
  const idControl = id ?? generado;
  return (
    <div className={`${styles.campo} ${className}`}>
      <label className={styles.etiqueta} htmlFor={idControl}>
        {etiqueta}
      </label>
      <div className={`${styles.control} ${styles.controlSelect} ${error ? styles.conError : ''}`}>
        <select id={idControl} className={styles.entrada} {...resto}>
          {children}
        </select>
        <svg className={styles.flecha} viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      {(error || ayuda) && <p className={error ? styles.error : styles.ayuda}>{error ?? ayuda}</p>}
    </div>
  );
}

type CampoAreaProps = Base & TextareaHTMLAttributes<HTMLTextAreaElement>;

export function CampoArea({ etiqueta, ayuda, error, id, className = '', ...resto }: CampoAreaProps) {
  const generado = useId();
  const idControl = id ?? generado;
  return (
    <div className={`${styles.campo} ${className}`}>
      <label className={styles.etiqueta} htmlFor={idControl}>
        {etiqueta}
      </label>
      <div className={`${styles.control} ${error ? styles.conError : ''}`}>
        <textarea id={idControl} className={`${styles.entrada} ${styles.area}`} {...resto} />
      </div>
      {(error || ayuda) && <p className={error ? styles.error : styles.ayuda}>{error ?? ayuda}</p>}
    </div>
  );
}
