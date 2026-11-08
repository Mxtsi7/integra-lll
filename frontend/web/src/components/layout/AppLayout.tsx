import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { BarraLateral } from './BarraLateral';
import { BarraSuperior } from './BarraSuperior';
import { Footer } from './Footer';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  headerTitulo: string;
  headerSubtitulo?: string;
  /** Botones a la derecha del título: la acción principal de la página. */
  headerAccionDerecha?: ReactNode;
  /** Contenido más angosto, para páginas de lectura (detalle, próximamente). */
  angosto?: boolean;
  children: ReactNode;
}

// Se muestran mientras /usuarios/me/ no respondió (o si falló por red).
const NOMBRE_USUARIO_PLACEHOLDER = 'Usuario';
const PLAN_PLACEHOLDER = 'Plan Gratuito';

export function AppLayout({
  headerTitulo,
  headerSubtitulo,
  headerAccionDerecha,
  angosto = false,
  children,
}: AppLayoutProps) {
  const { usuario, cerrarSesion } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const nombreUsuario = usuario?.nombre ?? NOMBRE_USUARIO_PLACEHOLDER;
  const plan = usuario
    ? usuario.plan === 'premium'
      ? 'Plan Premium'
      : 'Plan Gratuito'
    : PLAN_PLACEHOLDER;

  // Mientras el backend revoca la sesión el botón queda deshabilitado, para
  // que un doble clic no mande dos revocaciones.
  const [cerrandoSesion, setCerrandoSesion] = useState(false);

  async function manejarCerrarSesion() {
    if (cerrandoSesion) return;
    setCerrandoSesion(true);
    // cerrarSesion() revoca en el backend y SIEMPRE borra los tokens locales.
    const { revocada } = await cerrarSesion();
    if (revocada) {
      toast.info('Cerraste sesión.');
    } else {
      toast.error(
        'Cerraste sesión en este equipo, pero no pudimos confirmarlo con el servidor.',
      );
    }
    navigate('/login', { replace: true });
  }

  return (
    <div className={styles.app}>
      <BarraLateral />

      <div className={styles.columna}>
        <BarraSuperior
          nombreUsuario={nombreUsuario}
          plan={plan}
          alCerrarSesion={manejarCerrarSesion}
          cerrandoSesion={cerrandoSesion}
        />

        <main className={`${styles.contenido} ${angosto ? styles.angosto : ''}`}>
          <header className={styles.encabezado}>
            <div className={styles.titulos}>
              <h1 className={styles.titulo}>{headerTitulo}</h1>
              {headerSubtitulo && <p className={styles.subtitulo}>{headerSubtitulo}</p>}
            </div>
            {headerAccionDerecha && <div className={styles.acciones}>{headerAccionDerecha}</div>}
          </header>
          {children}
        </main>

        <Footer />
      </div>
    </div>
  );
}
