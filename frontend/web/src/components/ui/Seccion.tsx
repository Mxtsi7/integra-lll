import type { ReactNode } from 'react';
import styles from './Seccion.module.css';

export type TinteSeccion = 'ninguno' | 'acento' | 'verde' | 'turquesa' | 'morado' | 'azul' | 'coral';

interface SeccionProps {
  titulo: string;
  /** Qué hay acá, en una línea. Solo cuando el título no alcanza. */
  descripcion?: string;
  /** Un icono en un cuadrado de vidrio, a la izquierda del título. */
  icono?: ReactNode;
  /** Un botón o enlace a la derecha del título. */
  accion?: ReactNode;
  /** Tinte de color del tile: dice de qué familia es la información. */
  tinte?: TinteSeccion;
  children: ReactNode;
  className?: string;
}

const CLASE_TINTE: Record<TinteSeccion, string> = {
  ninguno: '',
  acento: styles.tinteAcento,
  verde: styles.tinteVerde,
  turquesa: styles.tinteTurquesa,
  morado: styles.tinteMorado,
  azul: styles.tinteAzul,
  coral: styles.tinteCoral,
};

/**
 * Tile de vidrio con título. Es la unidad de las páginas: un vidrio
 * difuminado sobre el fondo, con un tinte opcional que marca la familia.
 */
export function Seccion({
  titulo,
  descripcion,
  icono,
  accion,
  tinte = 'ninguno',
  children,
  className = '',
}: SeccionProps) {
  return (
    <section className={`tile ${styles.seccion} ${CLASE_TINTE[tinte]} ${className}`}>
      <header className={styles.cabecera}>
        {icono && <span className={styles.icono}>{icono}</span>}
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>{titulo}</h2>
          {descripcion && <p className={styles.descripcion}>{descripcion}</p>}
        </div>
        {accion}
      </header>
      {children}
    </section>
  );
}

/** Fila etiqueta + detalle + lo que vaya a la derecha, para Perfil y Configuración. */
export function Fila({
  etiqueta,
  detalle,
  children,
}: {
  etiqueta: ReactNode;
  detalle?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.fila}>
      <div className={styles.filaTexto}>
        <p className={styles.filaEtiqueta}>{etiqueta}</p>
        {detalle && <p className={styles.filaDetalle}>{detalle}</p>}
      </div>
      {children}
    </div>
  );
}
