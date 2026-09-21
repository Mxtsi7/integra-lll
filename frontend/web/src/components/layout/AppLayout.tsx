import type { ReactNode } from 'react';
import { Footer } from './Footer';
import { Header } from './Header';
import { Sidebar } from './Sidebar';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  headerTitulo: string;
  headerSubtitulo: string;
  headerEtiquetaFecha?: string;
  headerAccionDerecha?: ReactNode;
  children: ReactNode;
}

// TODO: reemplazar por los datos reales cuando Perfil + GET user esté integrado.
const NOMBRE_USUARIO_PLACEHOLDER = 'Usuario';
const PLAN_PLACEHOLDER = 'Plan Gratuito';

export function AppLayout({
  headerTitulo,
  headerSubtitulo,
  headerEtiquetaFecha,
  headerAccionDerecha,
  children,
}: AppLayoutProps) {
  return (
    <div className={styles.app}>
      <Sidebar nombreUsuario={NOMBRE_USUARIO_PLACEHOLDER} plan={PLAN_PLACEHOLDER} />

      <div className={styles.columna}>
        <div className={styles.contenido}>
          <Header
            titulo={headerTitulo}
            subtitulo={headerSubtitulo}
            etiquetaFecha={headerEtiquetaFecha}
            accionDerecha={headerAccionDerecha}
          />
          {children}
        </div>
        <Footer />
      </div>
    </div>
  );
}
