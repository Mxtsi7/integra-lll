import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { AppLayout } from '../components/layout/AppLayout';
import { BotonEnlace } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Seccion } from '../components/ui/Seccion';
import { useAuth } from '../context/AuthContext';
import styles from './HistorialAccesosPage.module.css';

/**
 * Un acceso a la cuenta. CONTRATO PROVISIONAL (S3-AN-06): todavía no existe el endpoint de
 * historial de accesos; quien lo cree debe ajustar estos campos a lo que responda el backend.
 */
export interface AccesoRegistrado {
  id: string;
  /** Fecha y hora del acceso, ISO 8601. */
  fecha: string;
  dispositivo: string;
  ubicacion?: string;
  /** true si es la sesión desde la que se está mirando. */
  actual?: boolean;
}

export interface HistorialAccesosPageProps {
  /**
   * Cómo traer los accesos. Mientras no exista el endpoint no se pasa y la página dice que
   * todavía no está disponible: nunca se inventan accesos.
   */
  cargarAccesos?: () => Promise<AccesoRegistrado[]>;
}

// Tope para no pintar una lista sin límite si el backend devuelve de más.
const MAXIMO_ACCESOS = 50;

type Estado = 'cargando' | 'error' | 'listo';

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'Fecha desconocida';
  return fecha.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

export function HistorialAccesosPage({ cargarAccesos }: HistorialAccesosPageProps) {
  const { capturarSesion } = useAuth();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [accesos, setAccesos] = useState<AccesoRegistrado[]>([]);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    if (!cargarAccesos) return;
    // Se anota la sesión y el intento: una respuesta lenta de una sesión anterior (o de un
    // intento ya reemplazado) no debe pintarse en la pantalla de ahora.
    const sesion = capturarSesion();
    let vigente = true;
    setEstado('cargando');
    cargarAccesos()
      .then((lista) => {
        if (!vigente || sesion !== capturarSesion()) return;
        setAccesos(lista);
        setEstado('listo');
      })
      .catch(() => {
        if (!vigente || sesion !== capturarSesion()) return;
        setEstado('error');
      });
    return () => {
      vigente = false;
    };
  }, [cargarAccesos, capturarSesion, intento]);

  return (
    <AppLayout headerTitulo="Historial de accesos" headerSubtitulo="Desde dónde se entró a tu cuenta." angosto>
      <Seccion titulo="Accesos recientes" icono={<History size={19} aria-hidden="true" />} tinte="azul">
        {!cargarAccesos ? (
          <div className={styles.aviso}>
            <p>Esta función todavía no está disponible. Cuando lo esté, verás aquí los accesos a tu cuenta.</p>
            <BotonEnlace to="/configuracion" variante="secundario" tamano="s">
              Volver a Ajustes
            </BotonEnlace>
          </div>
        ) : estado === 'cargando' ? (
          <p role="status">Cargando accesos…</p>
        ) : estado === 'error' ? (
          <ErrorConReintento
            mensaje="No pudimos cargar tu historial de accesos."
            onReintentar={() => setIntento((n) => n + 1)}
          />
        ) : accesos.length === 0 ? (
          <p>Todavía no hay accesos registrados.</p>
        ) : (
          <>
            <ul className={styles.lista}>
              {accesos.slice(0, MAXIMO_ACCESOS).map((acceso) => (
                <li key={acceso.id} className={styles.fila}>
                  <span className={styles.dispositivo}>
                    {acceso.dispositivo}
                    {acceso.actual && <span className={styles.actual}> · Esta sesión</span>}
                  </span>
                  <span className={styles.detalle}>
                    {formatearFecha(acceso.fecha)}
                    {acceso.ubicacion ? ` · ${acceso.ubicacion}` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {accesos.length > MAXIMO_ACCESOS && (
              <p className={styles.detalle}>Mostrando los {MAXIMO_ACCESOS} accesos más recientes.</p>
            )}
          </>
        )}
      </Seccion>
    </AppLayout>
  );
}

export default HistorialAccesosPage;
