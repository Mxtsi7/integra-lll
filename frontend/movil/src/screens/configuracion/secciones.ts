import type { ConfiguracionStackParamList } from '../../navigation/types';
import type { NavButtonProps } from '../components/NavButton';

// AN-04 · Secciones de la pantalla Configuración.
// Punto de extensión: para agregar una opción (p. ej. SE-32, preferencias de notificación),
// se añade un item a una sección. Un item SIN `destino` se muestra deshabilitado.

/**
 * Destinos válidos dentro del stack de configuración, derivados automáticamente
 * de la definición canónica en ConfiguracionStackParamList.
 */
export type DestinoConfiguracion = Exclude<keyof ConfiguracionStackParamList, 'ConfiguracionScreen'>;

export interface ItemConfiguracion {
  testID: string;
  titulo: string;
  /** Pantalla a la que lleva. Sin destino, el item queda deshabilitado ("próximamente"). */
  destino?: DestinoConfiguracion;
  variante?: NavButtonProps['variant'];
}

export interface SeccionConfiguracion {
  id: string;
  titulo: string;
  items: ItemConfiguracion[];
}

export const SECCIONES_CONFIGURACION: SeccionConfiguracion[] = [
  {
    id: 'cuenta',
    titulo: 'Cuenta',
    items: [
      { testID: 'go-perfil', titulo: 'Mi Perfil', destino: 'Perfil', variante: 'primary' },
      { testID: 'go-eliminar-cuenta', titulo: 'Eliminar Cuenta', destino: 'EliminarCuenta' },
    ],
  },
  {
    id: 'conexiones',
    titulo: 'Conexiones',
    items: [
      { testID: 'go-cuentas', titulo: 'Cuentas Conectadas', destino: 'CuentasConectadas' },
      { testID: 'go-autorizacion-correo', titulo: 'Autorización de Correo', destino: 'AutorizacionCorreo' },
    ],
  },
  {
    id: 'plan',
    titulo: 'Plan',
    items: [
      { testID: 'go-planes', titulo: 'Planes y Suscripción Premium', destino: 'Planes' },
      { testID: 'go-restricciones', titulo: 'Restricciones Premium', destino: 'RestriccionesPremium' },
    ],
  },
  {
    id: 'uso',
    titulo: 'Recolectores',
    items: [
      { testID: 'go-uso-recolectores', titulo: 'Acceso de uso', destino: 'UsoRecolectores' },
    ],
  },
  {
    id: 'preferencias',
    titulo: 'Preferencias',
    items: [
      { testID: 'go-alertas', titulo: 'Centro de Alertas', destino: 'Alertas' },
      // SE-32 (Sebastián): al integrarlo, agregar aquí su `destino`.
      { testID: 'pref-notificaciones', titulo: 'Preferencias de notificación' },
    ],
  },
];
