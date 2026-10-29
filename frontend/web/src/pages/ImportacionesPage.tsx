import { formatearFechaHora, getMisImportaciones, type Importacion } from '@ojoalgasto/shared';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import EmptyState from '../components/subscriptions/EmptyState';
import { Boton } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia } from '../components/ui/Insignia';
import { MENSAJE_SIN_RED } from '../utils/mensajes';
import { TONO_ESTADO } from './ImportacionPage';
import styles from './ImportacionesPage.module.css';

type Estado =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; importaciones: Importacion[]; hayMas: boolean; pagina: number; cargandoMas: boolean; errorMas: string | null };

const mensajeError = (err: unknown) =>
  err instanceof TypeError ? MENSAJE_SIN_RED : 'No pudimos cargar tus importaciones. Intenta de nuevo.';

/** Las importaciones de quien consulta (CH-27), de la más nueva a la más vieja, para llegar a su progreso. */
export function ImportacionesPage() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' });
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    setEstado({ tipo: 'cargando' });
    getMisImportaciones(1)
      .then((pagina) => {
        if (vigente) {
          setEstado({ tipo: 'listo', importaciones: pagina.results, hayMas: pagina.next !== null, pagina: 1, cargandoMas: false, errorMas: null });
        }
      })
      .catch((err: unknown) => {
        if (vigente) setEstado({ tipo: 'error', mensaje: mensajeError(err) });
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  const verMas = async () => {
    if (estado.tipo !== 'listo' || estado.cargandoMas) return;
    const siguiente = estado.pagina + 1;
    setEstado({ ...estado, cargandoMas: true, errorMas: null });
    try {
      const pagina = await getMisImportaciones(siguiente);
      setEstado((e) =>
        e.tipo === 'listo'
          ? {
              ...e,
              // Si entró una nueva mientras tanto, la página corre una posición: no se repite.
              importaciones: [...e.importaciones, ...pagina.results.filter((n) => !e.importaciones.some((v) => v.id === n.id))],
              hayMas: pagina.next !== null,
              pagina: siguiente,
              cargandoMas: false,
            }
          : e,
      );
    } catch (err: unknown) {
      setEstado((e) => (e.tipo === 'listo' ? { ...e, cargandoMas: false, errorMas: mensajeError(err) } : e));
    }
  };

  return (
    <AppLayout headerTitulo="Importaciones" headerSubtitulo="Tus cartolas y lecturas de correo." angosto>
      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando tus importaciones…</p>}
      {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={() => setIntento((n) => n + 1)} />}
      {estado.tipo === 'listo' && estado.importaciones.length === 0 && (
        <EmptyState
          icon={<FileSpreadsheet size={48} aria-hidden="true" />}
          title="Todavía no tienes importaciones"
          description="Cuando subas una cartola o leamos tu correo, aquí vas a ver cómo va."
        />
      )}
      {estado.tipo === 'listo' && estado.importaciones.length > 0 && (
        <>
          <ul className={styles.lista}>
            {estado.importaciones.map((imp) => (
              <li key={imp.id}>
                <Link to={`/importaciones/${encodeURIComponent(imp.id)}`} className={`tile ${styles.itemLista}`}>
                  <span className={styles.itemTexto}>
                    <span className={styles.itemTitulo}>{imp.nombre_archivo || imp.origen_legible}</span>
                    <span className={styles.detalle}>{formatearFechaHora(imp.creado_en)}</span>
                  </span>
                  <Insignia tono={TONO_ESTADO[imp.estado]}>{imp.estado_legible}</Insignia>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          {estado.errorMas && <ErrorConReintento mensaje={estado.errorMas} onReintentar={verMas} />}
          {estado.hayMas && !estado.errorMas && (
            <Boton variante="secundario" cargando={estado.cargandoMas} onClick={verMas} className={styles.verMas}>
              Ver más
            </Boton>
          )}
        </>
      )}
    </AppLayout>
  );
}
