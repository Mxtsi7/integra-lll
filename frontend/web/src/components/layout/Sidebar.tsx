import { NavLink } from 'react-router-dom';
import styles from './Sidebar.module.css';

const ITEMS_NAV = [
  { etiqueta: 'Inicio', icono: '🏠', ruta: '/home' },
  { etiqueta: 'Panel', icono: '▦', ruta: '/dashboard' },
  { etiqueta: 'Calendario de pagos', icono: '▤', ruta: '/calendario' },
  { etiqueta: 'Recomendaciones', icono: '✦', ruta: '/recomendaciones' },
  { etiqueta: 'Cuentas conectadas', icono: '⛓', ruta: '/cuentas' },
  { etiqueta: 'Informes', icono: '📈', ruta: '/informes' },
  { etiqueta: 'Configuración', icono: '⚙', ruta: '/configuracion' },
] as const;

interface SidebarProps {
  nombreUsuario: string;
  plan: string;
}

export function Sidebar({ nombreUsuario, plan }: SidebarProps) {
  return (
    <aside className={styles.sidebar}>
      <NavLink to="/home" className={styles.logo}>
        <span aria-hidden="true">👁</span> Ojo al Gasto
      </NavLink>

      <nav className={styles.nav}>
        {ITEMS_NAV.map((item) => (
          <NavLink
            key={item.etiqueta}
            to={item.ruta}
            className={({ isActive }) =>
              isActive ? `${styles.navItem} ${styles.navItemActivo}` : styles.navItem
            }
          >
            <span className={styles.navIcono} aria-hidden="true">
              {item.icono}
            </span>
            {item.etiqueta}
          </NavLink>
        ))}
      </nav>

      <NavLink
        to="/perfil"
        className={({ isActive }) =>
          isActive ? `${styles.usuario} ${styles.usuarioActivo}` : styles.usuario
        }
      >
        <p className={styles.usuarioNombre}>{nombreUsuario}</p>
        <p className={styles.usuarioPlan}>{plan}</p>
      </NavLink>
    </aside>
  );
}
