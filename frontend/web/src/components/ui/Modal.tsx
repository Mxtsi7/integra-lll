import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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

const ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/** Lo que se puede alcanzar con Tab dentro del panel, en orden. */
function enfocablesDe(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(
    (el) => !el.closest('[hidden], [inert]') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Con qué empieza el foco (CH-25): lo que pida autoFocus, si no el primer
 * campo, si no el primer botón que no sea la X. Antes era el primero en el
 * DOM entre todos, y en "Nueva suscripción" caía en "Actualizar opciones".
 */
function focoInicial(panel: HTMLElement): HTMLElement {
  return (
    panel.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
    panel.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])') ??
    panel.querySelector<HTMLElement>('button:not([disabled]):not([data-cerrar])') ??
    panel
  );
}

// Los modales abiertos, del de más abajo al de más arriba: Escape cierra solo el de arriba.
const abiertos: symbol[] = [];

/**
 * Ventana flotante. Se cierra con Escape, con la X y (si no es alerta)
 * tocando el fondo. Al abrir mueve el foco adentro, Tab y Shift+Tab no salen
 * de ella, y al cerrar el foco vuelve al elemento que la abrió (CH-25).
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
  const id = useId();
  const idTitulo = `${id}-titulo`;
  const idDescripcion = `${id}-descripcion`;
  // La última versión de alCerrar, sin que el efecto dependa de ella: si el
  // padre pasa una función nueva en cada render, el efecto se volvía a
  // correr, el foco salía del modal y volvía al primer campo.
  const cerrar = useRef(alCerrar);
  cerrar.current = alCerrar;
  // Lo que tenía el foco al abrir, tomado al renderizar y no en el efecto:
  // los efectos de los hijos corren antes, y si uno ya movió el foco adentro
  // (el formulario enfoca su primer campo) el efecto veía ese campo y no el
  // botón que abrió el modal. Al cerrar, el foco se perdía en <body>.
  const [abridor] = useState(() => (document.activeElement instanceof HTMLElement ? document.activeElement : null));

  useEffect(() => {
    const yo = Symbol('modal');
    abiertos.push(yo);
    const contenedor = panel.current;
    // Si un hijo ya puso el foco adentro, se respeta su elección.
    if (contenedor && !contenedor.contains(document.activeElement)) focoInicial(contenedor).focus();

    function alTeclear(e: KeyboardEvent) {
      if (abiertos[abiertos.length - 1] !== yo || !contenedor) return;
      if (e.key === 'Escape') {
        cerrar.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const enfocables = enfocablesDe(contenedor);
      if (enfocables.length === 0) {
        e.preventDefault();
        contenedor.focus();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const actual = document.activeElement;
      const dentro = actual instanceof Node && contenedor.contains(actual);
      if (e.shiftKey && (actual === primero || actual === contenedor || !dentro)) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && (actual === ultimo || !dentro)) {
        e.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener('keydown', alTeclear);
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', alTeclear);
      abiertos.splice(abiertos.indexOf(yo), 1);
      document.body.style.overflow = overflowAnterior;
      // Si lo que la abrió ya no está (p. ej. la fila que se eliminó), no se fuerza nada.
      if (abridor?.isConnected) abridor.focus();
    };
  }, [abridor]);

  return (
    <div
      className={styles.fondo}
      onMouseDown={(e) => {
        if (tipo === 'dialogo' && e.target === e.currentTarget) cerrar.current();
      }}
    >
      <div
        ref={panel}
        className={`${styles.panel} ${ancho === 'medio' ? styles.medio : ''}`}
        role={tipo === 'alerta' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDescripcion : undefined}
        tabIndex={-1}
      >
        <header className={styles.cabecera}>
          <div>
            <h2 id={idTitulo} className={styles.titulo}>
              {titulo}
            </h2>
            {descripcion && (
              <p id={idDescripcion} className={styles.descripcion}>
                {descripcion}
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.cerrar}
            onClick={() => cerrar.current()}
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
