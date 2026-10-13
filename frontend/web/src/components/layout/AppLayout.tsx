import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
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

// Se muestran mientras /usuarios/me/ no respondió (o si falló por red).
// Antes eran los únicos valores: ahora el nombre y el plan salen del
// AuthContext, que los recupera también al recargar la página.
const NOMBRE_USUARIO_PLACEHOLDER = 'Usuario';
const PLAN_PLACEHOLDER = 'Plan Gratuito';

export function AppLayout({
  headerTitulo,
  headerSubtitulo,
  headerEtiquetaFecha,
  headerAccionDerecha,
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
    // Antes solo se borraban los locales; la revisión de la PR #57 (CH-03)
    // pidió revocar también en el servidor y avisar si eso falla.
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
      <Sidebar
        nombreUsuario={nombreUsuario}
        plan={plan}
        alCerrarSesion={manejarCerrarSesion}
        cerrandoSesion={cerrandoSesion}
      />

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
