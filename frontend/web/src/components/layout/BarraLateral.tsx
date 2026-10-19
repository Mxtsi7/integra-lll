import { NavLink } from 'react-router-dom';
import {
  CalendarDays,
  ChartNoAxesColumn,
  Home,
  LayoutDashboard,
  Link2,
  Settings,
  Sparkles,
} from 'lucide-react';
import { OjoMarca } from './Marca';
import styles from './BarraLateral.module.css';

export const DESTINOS = [
  { etiqueta: 'Inicio', ruta: '/home', Icono: Home },
  { etiqueta: 'Panel', ruta: '/dashboard', Icono: LayoutDashboard },
  { etiqueta: 'Calendario', ruta: '/calendario', Icono: CalendarDays },
  { etiqueta: 'Consejos', ruta: '/recomendaciones', Icono: Sparkles },
  { etiqueta: 'Cuentas', ruta: '/cuentas', Icono: Link2 },
  { etiqueta: 'Informes', ruta: '/informes', Icono: ChartNoAxesColumn },
  { etiqueta: 'Ajustes', ruta: '/configuracion', Icono: Settings },
] as const;

/**
 * El riel de iconos a la izquierda. En celular se vuelve una barra de
 * pestañas abajo, que es donde el pulgar llega.
 */
export function BarraLateral() {
  return (
    <aside className={styles.rail}>
      <NavLink to="/home" className={styles.marca} aria-label="Ojo al Gasto">
        <OjoMarca tamano={40} />
      </NavLink>

      <nav className={styles.nav} aria-label="Principal">
        {DESTINOS.map(({ etiqueta, ruta, Icono }) => (
          <NavLink
            key={ruta}
            to={ruta}
            className={({ isActive }) => (isActive ? `${styles.item} ${styles.activo}` : styles.item)}
          >
            <span className={styles.itemIcono}>
              <Icono size={20} aria-hidden="true" />
            </span>
            <span className={styles.itemTexto}>{etiqueta}</span>
          </NavLink>
        ))}
      </nav>

      <p className={styles.lema} aria-hidden="true">
        Ojo
        <br />
        al
        <br />
        gasto
      </p>
    </aside>
  );
}
