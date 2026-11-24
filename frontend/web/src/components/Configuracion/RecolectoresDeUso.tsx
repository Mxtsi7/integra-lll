import { Activity } from 'lucide-react';
import { Seccion } from '../ui/Seccion';

/** Lo que se muestra de un recolector: qué permisos pide y cómo se activa. */
interface RecolectorDeUso {
  nombre: string;
  permisos: string;
  pasos: string[];
}

const RECOLECTORES: RecolectorDeUso[] = [
  {
    nombre: 'Android',
    permisos: 'Acceso de uso (estadísticas de uso de aplicaciones)',
    pasos: [
      'Instala la app de Ojo al gasto para Android.',
      'En Ajustes de Android, entra a Acceso especial a aplicaciones y elige Acceso de uso. La ruta puede cambiar según tu teléfono.',
      'Activa Ojo al gasto en esa lista y vuelve a la app.',
    ],
  },
  {
    nombre: 'Extensión del navegador',
    permisos: 'Los que pide el navegador al instalar la extensión',
    pasos: [
      'Instala la extensión de Ojo al gasto en tu navegador.',
      'Acepta los permisos que pide el navegador al instalarla.',
      'Vuelve a esta página para revisar su estado.',
    ],
  },
];

// La web todavía no recibe el estado de los recolectores: sin esa evidencia, ninguno se muestra activo.
const ESTADO_SIN_EVIDENCIA = 'Todavía no recibimos su estado';

/**
 * S3-CH-21: cómo activar cada recolector de uso y en qué estado está. Ninguno se muestra como
 * activo sin evidencia de su estado.
 */
export function RecolectoresDeUso() {
  return (
    <Seccion
      titulo="Recolectores de uso"
      descripcion="Registran el uso de tus suscripciones desde tu teléfono y tu navegador."
      icono={<Activity size={19} aria-hidden="true" />}
      tinte="azul"
    >
      {RECOLECTORES.map((recolector) => (
        <section key={recolector.nombre} aria-label={recolector.nombre}>
          <h3>{recolector.nombre}</h3>
          <p>Permisos requeridos: {recolector.permisos}.</p>
          <ol>
            {recolector.pasos.map((paso) => (
              <li key={paso}>{paso}</li>
            ))}
          </ol>
          <p>
            Estado: <span>{ESTADO_SIN_EVIDENCIA}</span>
          </p>
        </section>
      ))}
    </Seccion>
  );
}
