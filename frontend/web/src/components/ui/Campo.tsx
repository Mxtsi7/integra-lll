import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import styles from './Campo.module.css';

interface Base {
  etiqueta: string;
  /** Texto corto debajo del control: formato esperado, consecuencia, etc. */
  ayuda?: string;
  error?: string;
  /** Icono a la izquierda, dentro del control. */
  icono?: ReactNode;
}

type CampoTextoProps = Base &
  InputHTMLAttributes<HTMLInputElement> & {
    /** Control a la derecha, dentro del campo (p. ej. el botón de ver contraseña). */
    accesorio?: ReactNode;
  };

export function CampoTexto({
  etiqueta,
  ayuda,
  error,
  icono,
  accesorio,
  id,
  className = '',
  ...resto
}: CampoTextoProps) {
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
        {accesorio}
      </div>
      {(error || ayuda) && (
        <p id={idAyuda} className={error ? styles.error : styles.ayuda}>
          {error ?? ayuda}
        </p>
      )}
    </div>
  );
}

type CampoContrasenaProps = Omit<CampoTextoProps, 'type' | 'accesorio'>;

/**
 * Campo de contraseña con botón para mostrarla u ocultarla (CH-05).
 *
 * - Empieza siempre oculta (type="password").
 * - El botón es type="button": nunca envía el formulario.
 * - Al hacer clic con el mouse el foco se queda en el campo (preventDefault
 *   en mousedown), así se puede seguir escribiendo.
 * - Accesible: es un botón nativo (Tab + Enter/Espacio), con nombre fijo
 *   "Mostrar contraseña" y aria-pressed para el estado, que es el patrón de
 *   botón de alternancia de WAI-ARIA (el nombre no cambia, cambia el estado).
 * - El valor no se toca: solo cambia el type del input.
 */
export function CampoContrasena({ id, disabled, ...resto }: CampoContrasenaProps) {
  const [visible, setVisible] = useState(false);
  const generado = useId();
  const idControl = id ?? generado;
  return (
    <CampoTexto
      {...resto}
      id={idControl}
      disabled={disabled}
      type={visible ? 'text' : 'password'}
      accesorio={
        <button
          type="button"
          className={styles.alternar}
          aria-label="Mostrar contraseña"
          aria-pressed={visible}
          aria-controls={idControl}
          title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
        </button>
      }
    />
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
