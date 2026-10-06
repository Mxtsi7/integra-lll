import type { ReactNode } from 'react';
import { useAuth } from '../../context/AuthContext';
import styles from './Header.module.css';

interface HeaderProps {
  titulo: string;
  subtitulo?: string;
  etiquetaFecha?: string;
  accionDerecha?: ReactNode;
}

export function Header({ titulo, subtitulo, etiquetaFecha, accionDerecha }: HeaderProps) {
  const { usuario, cargando } = useAuth();
  const inicial = usuario?.nombre ? usuario.nombre.charAt(0).toUpperCase() : '?';

  return (
    <header className={styles.encabezado}>
      <div>
        <h1 className={styles.titulo}>{titulo}</h1>
        {subtitulo && <p className={styles.subtitulo}>{subtitulo}</p>}
      </div>

      <div className={styles.derecha}>
        {etiquetaFecha && (
          <button type="button" className={styles.selectorFecha}>
            <span aria-hidden="true">📅</span> {etiquetaFecha}
          </button>
        )}
        {accionDerecha}

        <div className={styles.usuarioPerfil}>
          <span className={styles.nombreUsuario}>
            {cargando ? 'Cargando...' : usuario?.nombre || 'Sin sesión'}
          </span>
          <div className={styles.avatar} aria-hidden="true">
            {inicial}
          </div>
        </div>
      </div>
    </header>
  );
}
