import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, LogOut, Search } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../Spinner';
import { Marca } from './Marca';
import styles from './BarraSuperior.module.css';

interface BarraSuperiorProps {
  nombreUsuario: string;
  plan: string;
  /** Cuántas cosas piden atención: cobros de esta semana y suscripciones sin uso. */
  avisos?: number;
  alCerrarSesion: () => void;
  /** true mientras el backend revoca la sesión. */
  cerrandoSesion?: boolean;
}

/**
 * Marca, buscador, campana y usuario. El buscador vive en la URL
 * (`/home?q=`): así cualquier página puede buscar y el resultado se puede
 * compartir o recargar.
 */
export function BarraSuperior({
  nombreUsuario,
  plan,
  avisos = 0,
  alCerrarSesion,
  cerrandoSesion = false,
}: BarraSuperiorProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [parametros] = useSearchParams();
  const [busqueda, setBusqueda] = useState(parametros.get('q') ?? '');

  // Si la URL cambia por fuera (atrás, enlace), el cuadro sigue a la URL.
  useEffect(() => {
    setBusqueda(parametros.get('q') ?? '');
  }, [parametros]);

  // Ya en Inicio, buscar conserva los filtros y el orden que también viven en
  // la URL (CH-11, CH-12); desde otra página se llega a Inicio solo con la
  // búsqueda.
  function urlDeBusqueda(q: string): string {
    const parametros = new URLSearchParams(location.pathname === '/home' ? location.search : '');
    if (q) parametros.set('q', q);
    else parametros.delete('q');
    const texto = parametros.toString();
    return texto ? `/home?${texto}` : '/home';
  }

  function enviar(e: FormEvent) {
    e.preventDefault();
    navigate(urlDeBusqueda(busqueda.trim()));
  }

  function alEscribir(valor: string) {
    setBusqueda(valor);
    // En Inicio se filtra mientras escribes; en otras páginas, al enviar.
    if (location.pathname === '/home') {
      navigate(urlDeBusqueda(valor.trim()), { replace: true });
    }
  }

  return (
    <header className={styles.barra}>
      <div className={styles.marca}>
        <Marca />
      </div>

      <form className={styles.buscador} role="search" onSubmit={enviar}>
        <Search size={17} className={styles.buscadorIcono} aria-hidden="true" />
        <input
          type="search"
          className={styles.buscadorEntrada}
          placeholder="Buscar una suscripción"
          aria-label="Buscar una suscripción"
          value={busqueda}
          onChange={(e) => alEscribir(e.target.value)}
        />
      </form>

      <div className={styles.derecha}>
        <Link
          to="/dashboard"
          className={styles.campana}
          aria-label={avisos > 0 ? `${avisos} avisos, ver el Panel` : 'Sin avisos, ver el Panel'}
          title={avisos > 0 ? `${avisos} avisos` : 'Sin avisos'}
        >
          <Bell size={18} aria-hidden="true" />
          {avisos > 0 && <span className={styles.campanaConteo}>{avisos > 9 ? '9+' : avisos}</span>}
        </Link>

        <NavLink
          to="/perfil"
          className={({ isActive }) => (isActive ? `${styles.usuario} ${styles.usuarioActivo}` : styles.usuario)}
        >
          <Avatar nombre={nombreUsuario} forma="persona" tamano={38} />
          <span className={styles.usuarioTexto}>
            <span className={styles.usuarioNombre}>{nombreUsuario}</span>
            <span className={styles.usuarioPlan}>{plan}</span>
          </span>
        </NavLink>

        <button
          type="button"
          className={styles.salir}
          onClick={alCerrarSesion}
          disabled={cerrandoSesion}
          title="Cerrar sesión"
        >
          {cerrandoSesion ? <Spinner size={14} decorativo /> : <LogOut size={17} aria-hidden="true" />}
          <span className="solo-lectura">{cerrandoSesion ? 'Cerrando sesión…' : 'Cerrar sesión'}</span>
        </button>
      </div>
    </header>
  );
}
