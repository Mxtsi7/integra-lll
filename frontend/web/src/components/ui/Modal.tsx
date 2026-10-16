import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './Modal.module.css';

interface ModalProps {
  titulo: string;
  /** Una línea bajo el título: para qué sirve lo que se abre. */
  descripcion?: string;
  alCerrar: () => void;
  children: ReactNode;
  /** 'alerta' para confirmaciones destructivas: role alertdialog y sin cierre por fondo. */
  tipo?: 'dialogo' | 'alerta';
  ancho?: 'angosto' | 'medio';
}

/**
 * Ventana flotante. Se cierra con Escape, con la X y (si no es alerta)
 * tocando el fondo. Al abrir mueve el foco adentro; al cerrar lo devuelve
 * al elemento que la abrió.
 */
export function Modal({
  titulo,
  descripcion,
  alCerrar,
  children,
  tipo = 'dialogo',
  ancho = 'angosto',
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primero = panel.current?.querySelector<HTMLElement>(
      'input, select, textarea, button:not([data-cerrar])',
    );
    (primero ?? panel.current)?.focus();

    function alTeclear(e: KeyboardEvent) {
      if (e.key === 'Escape') alCerrar();
    }
    document.addEventListener('keydown', alTeclear);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alTeclear);
      document.body.style.overflow = overflowAnterior;
      anterior?.focus?.();
    };
  }, [alCerrar]);

  return (
    <div
      className={styles.fondo}
      onMouseDown={(e) => {
        if (tipo === 'dialogo' && e.target === e.currentTarget) alCerrar();
      }}
    >
      <div
        ref={panel}
        className={`${styles.panel} ${ancho === 'medio' ? styles.medio : ''}`}
        role={tipo === 'alerta' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="modal-titulo"
        tabIndex={-1}
      >
        <header className={styles.cabecera}>
          <div>
            <h2 id="modal-titulo" className={styles.titulo}>
              {titulo}
            </h2>
            {descripcion && <p className={styles.descripcion}>{descripcion}</p>}
          </div>
          <button
            type="button"
            className={styles.cerrar}
            onClick={alCerrar}
            aria-label="Cerrar"
            data-cerrar
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.cuerpo}>{children}</div>
      </div>
    </div>
  );
}
