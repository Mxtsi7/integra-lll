import { CalendarDays, ChartNoAxesColumn, Link2, Sparkles } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { BotonEnlace } from '../components/ui/Boton';
import styles from './ProximamentePage.module.css';

type Clave = 'calendario' | 'recomendaciones' | 'cuentas' | 'informes';

/**
 * Lo que va a hacer cada sección que todavía no existe. Antes estos cuatro
 * destinos del menú caían al comodín y devolvían al Panel sin decir nada;
 * ahora dicen qué viene y qué puedes hacer mientras tanto.
 */
const SECCIONES: Record<
  Clave,
  { titulo: string; Icono: typeof CalendarDays; que: string; mientras: string; ruta: string; accion: string }
> = {
  calendario: {
    titulo: 'Calendario de pagos',
    Icono: CalendarDays,
    que: 'Verás cada cobro en el día que corresponde, con el total de la semana y del mes.',
    mientras: 'Los cobros de los próximos 7 días ya aparecen en el Panel.',
    ruta: '/dashboard',
    accion: 'Ir al Panel',
  },
  recomendaciones: {
    titulo: 'Recomendaciones',
    Icono: Sparkles,
    que: 'Sugerencias concretas para gastar menos: qué pausar, qué pasar a plan anual, qué compartir con tu hogar.',
    mientras: 'El Panel ya marca las suscripciones fantasma: las que pagas y no usas.',
    ruta: '/dashboard',
    accion: 'Ver fantasmas',
  },
  cuentas: {
    titulo: 'Cuentas conectadas',
    Icono: Link2,
    que: 'Conecta tu correo y los cobros nuevos se registran solos, sin tipear nada.',
    mientras: 'Hoy registras cada suscripción a mano desde Inicio.',
    ruta: '/home',
    accion: 'Agregar suscripción',
  },
  informes: {
    titulo: 'Informes',
    Icono: ChartNoAxesColumn,
    que: 'Cómo cambió tu gasto mes a mes y cuánto llevas pagado en el año por cada servicio.',
    mientras: 'Puedes exportar tus suscripciones a CSV desde el Panel.',
    ruta: '/dashboard',
    accion: 'Ir al Panel',
  },
};

export function ProximamentePage({ seccion }: { seccion: Clave }) {
  const { titulo, Icono, que, mientras, ruta, accion } = SECCIONES[seccion];
  return (
    <AppLayout headerTitulo={titulo} angosto>
      <section className={styles.tarjeta}>
        <span className={styles.icono}>
          <Icono size={26} aria-hidden="true" />
        </span>
        <p className={styles.estado}>En construcción</p>
        <p className={styles.que}>{que}</p>
        <p className={styles.mientras}>{mientras}</p>
        <BotonEnlace to={ruta} variante="secundario">
          {accion}
        </BotonEnlace>
      </section>
    </AppLayout>
  );
}
