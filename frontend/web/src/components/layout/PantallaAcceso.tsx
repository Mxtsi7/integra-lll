import type { ReactNode } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Marca } from './Marca';
import styles from './PantallaAcceso.module.css';

interface PantallaAccesoProps {
  /** El h1 de la página. */
  titulo: string;
  descripcion?: string;
  children: ReactNode;
  /** Lo que va bajo el formulario: el enlace para cambiar de pantalla. */
  pie?: ReactNode;
}

/**
 * Marco de las pantallas sin sesión: login, registro y recuperación. Una
 * tarjeta de vidrio al centro, sobre el fondo con brillos, con la marca
 * arriba. La misma casa que verás adentro, antes de entrar.
 */
export function PantallaAcceso({ titulo, descripcion, children, pie }: PantallaAccesoProps) {
  return (
    <div className={styles.pantalla}>
      <div className={styles.columna}>
        <div className={styles.marca}>
          <Marca a="/login" tamano="l" />
        </div>

        <main className={`tile ${styles.tarjeta}`}>
          <h1 className={styles.titulo}>{titulo}</h1>
          {descripcion && <p className={styles.descripcion}>{descripcion}</p>}
          {children}
          {pie && <div className={styles.pie}>{pie}</div>}
        </main>

        <p className={styles.nota}>
          <ShieldCheck size={14} aria-hidden="true" />
          Conexión cifrada
        </p>
      </div>
    </div>
  );
}
