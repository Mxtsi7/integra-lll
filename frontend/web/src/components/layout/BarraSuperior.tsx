import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bell, LogOut, Search } from 'lucide-react';
import { Avatar } from '../ui/Avatar';
import { Spinner } from '../Spinner';
import { useContadorAlertas } from '../../context/ContadorAlertasContext';
import { Marca } from './Marca';
import styles from './BarraSuperior.module.css';

interface BarraSuperiorProps {
  nombreUsuario: string;
  plan: string;
  alCerrarSesion: () => void;
  /** true mientras el backend revoca la sesión. */
  cerrandoSesion?: boolean;
}

/** "1 alerta sin leer", "3 alertas sin leer". */
function textoPendientes(pendientes: number): string {
  return pendientes === 1 ? '1 alerta sin leer' : `${pendientes} alertas sin leer`;
}

/**
 * Marca, buscador, campana y usuario. El buscador vive en la URL
 * (`/home?q=`): así cualquier página puede buscar y el resultado se puede
 * compartir o recargar.
 */
export function BarraSuperior({
  nombreUsuario,
  plan,
  alCerrarSesion,
  cerrandoSesion = false,
}: BarraSuperiorProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [parametros] = useSearchParams();
  const [busqueda, setBusqueda] = useState(parametros.get('q') ?? '');
  const idPendientes = useId();
  // El mismo número en todas las páginas; el Centro de alertas lo baja al leer.
  // null (todavía no se sabe) se muestra igual que cero: sin número.
  const pendientes = useContadorAlertas().pendientes ?? 0;
  const hayPendientes = pendientes > 0;

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
        {/* La campana abre el Centro de alertas (CH-31); los ajustes de
            avisos quedan a un clic desde ahí. Su nombre no cambia con el
            número: las sin leer van como descripción. */}
        <Link
          to="/alertas"
          className={styles.campana}
          aria-label="Alertas"
          aria-describedby={hayPendientes ? idPendientes : undefined}
          title={hayPendientes ? `Alertas · ${textoPendientes(pendientes)}` : 'Alertas'}
        >
          <Bell size={18} aria-hidden="true" />
          {hayPendientes && (
            <>
              <span className={styles.campanaConteo} aria-hidden="true">
                {pendientes > 9 ? '9+' : pendientes}
              </span>
              <span id={idPendientes} className="solo-lectura">
                {textoPendientes(pendientes)}
              </span>
            </>
          )}
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
