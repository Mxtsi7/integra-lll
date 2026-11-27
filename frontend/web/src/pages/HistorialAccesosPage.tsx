import { useCallback, useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';
import {
  obtenerHistorialAccesos,
  type AccesoRegistrado,
  type MetodoAcceso,
  type PaginaAccesos,
} from '@ojoalgasto/shared';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Seccion } from '../components/ui/Seccion';
import { useAuth } from '../context/AuthContext';
import styles from './HistorialAccesosPage.module.css';

export interface HistorialAccesosPageProps {
  /** Por defecto GET /usuarios/me/historial-accesos/ (S3-AN-06). Se inyecta en las pruebas. */
  cargarPagina?: (offset: number) => Promise<PaginaAccesos>;
}

// Tope de lo que se acumula en pantalla aunque el backend siga ofreciendo más páginas.
const MAXIMO_ACCESOS = 100;

const ETIQUETA_METODO: Record<MetodoAcceso, string> = {
  local: 'Con contraseña',
  google: 'Con Google',
};

type Estado = 'cargando' | 'error' | 'listo';

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return 'Fecha desconocida';
  return fecha.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
}

const cargarPaginaPorDefecto = (offset: number) => obtenerHistorialAccesos({ offset });

export function HistorialAccesosPage({ cargarPagina = cargarPaginaPorDefecto }: HistorialAccesosPageProps) {
  const { capturarSesion } = useAuth();
  const [estado, setEstado] = useState<Estado>('cargando');
  const [accesos, setAccesos] = useState<AccesoRegistrado[]>([]);
  const [siguienteOffset, setSiguienteOffset] = useState<number | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorMas, setErrorMas] = useState(false);
  const [intento, setIntento] = useState(0);
  // Cada carga inicial y el desmontaje invalidan las respuestas en vuelo (también "cargar más").
  const generacion = useRef(0);
  const pidiendoMas = useRef(false);

  useEffect(() => {
    // Se anota la sesión y la generación: una respuesta lenta de una sesión anterior (o de un
    // intento ya reemplazado) no debe pintarse en la pantalla de ahora.
    const sesion = capturarSesion();
    const miGeneracion = ++generacion.current;
    pidiendoMas.current = false;
    setEstado('cargando');
    setCargandoMas(false);
    setErrorMas(false);
    cargarPagina(0)
      .then((pagina) => {
        if (miGeneracion !== generacion.current || sesion !== capturarSesion()) return;
        setAccesos(pagina.accesos);
        setSiguienteOffset(pagina.siguienteOffset);
        setEstado('listo');
      })
      .catch(() => {
        if (miGeneracion !== generacion.current || sesion !== capturarSesion()) return;
        setEstado('error');
      });
    return () => {
      generacion.current++;
    };
  }, [cargarPagina, capturarSesion, intento]);

  const cargarMas = useCallback(() => {
    if (siguienteOffset === null || pidiendoMas.current) return;
    pidiendoMas.current = true;
    setCargandoMas(true);
    setErrorMas(false);
    const sesion = capturarSesion();
    const miGeneracion = generacion.current;
    cargarPagina(siguienteOffset)
      .then((pagina) => {
        if (miGeneracion !== generacion.current || sesion !== capturarSesion()) return;
        setAccesos((previos) => [...previos, ...pagina.accesos]);
        setSiguienteOffset(pagina.siguienteOffset);
      })
      .catch(() => {
        if (miGeneracion !== generacion.current || sesion !== capturarSesion()) return;
        setErrorMas(true);
      })
      .finally(() => {
        if (miGeneracion !== generacion.current) return;
        pidiendoMas.current = false;
        setCargandoMas(false);
      });
  }, [cargarPagina, capturarSesion, siguienteOffset]);

  const hayMas = siguienteOffset !== null && accesos.length < MAXIMO_ACCESOS;

  return (
    <AppLayout headerTitulo="Historial de accesos" headerSubtitulo="Cuándo y cómo se entró a tu cuenta." angosto>
      <Seccion titulo="Accesos recientes" icono={<History size={19} aria-hidden="true" />} tinte="azul">
        {estado === 'cargando' ? (
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
            <p className={styles.detalle}>Solo se muestran los inicios de sesión que conservamos.</p>
            <ul className={styles.lista}>
              {accesos.map((acceso, i) => (
                <li key={`${acceso.iniciadaEn}-${i}`} className={styles.fila}>
                  <span className={styles.dispositivo}>{formatearFecha(acceso.iniciadaEn)}</span>
                  <span className={styles.detalle}>{ETIQUETA_METODO[acceso.metodo]}</span>
                </li>
              ))}
            </ul>
            {errorMas && <p role="alert">No pudimos cargar más accesos. Inténtalo de nuevo.</p>}
            {hayMas && (
              <Boton variante="secundario" tamano="s" onClick={cargarMas} cargando={cargandoMas}>
                Cargar más
              </Boton>
            )}
            {siguienteOffset !== null && accesos.length >= MAXIMO_ACCESOS && (
              <p className={styles.detalle}>Mostrando los {MAXIMO_ACCESOS} accesos más recientes.</p>
            )}
          </>
        )}
      </Seccion>
    </AppLayout>
  );
}

export default HistorialAccesosPage;
