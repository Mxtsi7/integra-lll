import { Activity } from 'lucide-react';
import { Seccion } from '../ui/Seccion';

/** Lo que se muestra de un recolector: qué permisos pide, cómo se activa y dónde se revisa su estado. */
interface RecolectorDeUso {
  nombre: string;
  permisos: string;
  pasos: string[];
  nota: string;
}

// Los pasos siguen los controles reales: instalar la extensión no autoriza ningún sitio, y el permiso
// de cada sitio lo pide el navegador al autorizarlo desde el panel.
const RECOLECTORES: RecolectorDeUso[] = [
  {
    nombre: 'Android',
    permisos: 'Acceso de uso (estadísticas de uso de aplicaciones)',
    pasos: [
      'Instala la app de Ojo al gasto en tu teléfono Android.',
      'En la app, entra a Configuración, pulsa «Acceso de uso» y después «Abrir ajustes de acceso al uso». En Ajustes de Android, activa el acceso de uso para Ojo al gasto. La ruta puede cambiar según tu teléfono.',
      'Vuelve a la app para comprobar el permiso. Luego escribe el paquete que quieres medir, pulsa «Acepto autorizar la consulta local» y después «Consultar intervalos»: la consulta se hace en tu teléfono, no se envía al servidor.',
    ],
    nota: 'Revisa el permiso y la consulta en la app, en «Acceso de uso».',
  },
  {
    nombre: 'Extensión del navegador',
    permisos: 'Permiso de cada sitio que elijas, que el navegador pide al autorizarlo',
    pasos: [
      'Instala la extensión en Chrome o Edge de escritorio: Extensiones → Modo desarrollador → Cargar descomprimida, y elige la carpeta de la extensión. Instalarla no autoriza ningún sitio.',
      'Abre el botón de la extensión, escribe los dominios exactos que quieres observar (por ejemplo netflix.com), uno por línea, y marca «Acepto observar estos dominios durante esta sesión».',
      'Pulsa «Autorizar dominios» y acepta el permiso del navegador. Si no lo aceptas, no se observa ningún sitio. Mientras el panel está abierto se ve el estado de la captura.',
    ],
    nota: 'Revisa el estado de la captura en el panel de la extensión; esta página todavía no lo recibe.',
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
          <p>{recolector.nota}</p>
        </section>
      ))}
    </Seccion>
  );
}
