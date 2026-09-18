import type { ReactNode } from 'react';
import styles from './Header.module.css';

interface HeaderProps {
  titulo: string;
  subtitulo: string;
  etiquetaFecha?: string;
  accionDerecha?: ReactNode;
}

export function Header({ titulo, subtitulo, etiquetaFecha, accionDerecha }: HeaderProps) {
  return (
    <header className={styles.encabezado}>
      <div>
        <h1 className={styles.titulo}>{titulo}</h1>
        <p className={styles.subtitulo}>{subtitulo}</p>
      </div>

      <div className={styles.derecha}>
        {etiquetaFecha && (
          <button type="button" className={styles.selectorFecha}>
            <span aria-hidden="true">📅</span> {etiquetaFecha}
          </button>
        )}
        {accionDerecha}
        <div className={styles.avatar} aria-hidden="true" />
      </div>
    </header>
  );
}
