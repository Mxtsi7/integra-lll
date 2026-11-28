import { formatearFechaHora, getLecturasDeCorreo, getMisImportaciones, type Importacion } from '@ojoalgasto/shared';
import { ChevronRight, FileSpreadsheet } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import EmptyState from '../components/subscriptions/EmptyState';
import { Boton } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia } from '../components/ui/Insignia';
import { SubirArchivoCsv } from '../components/importaciones/SubirArchivoCsv';
import { useListaDeImportaciones } from '../hooks/useListaDeImportaciones';
import { TONO_ESTADO } from './ImportacionPage';
import styles from './ImportacionesPage.module.css';

/**
 * Las importaciones (CH-27) en dos partes: las cartolas que subió quien consulta y las lecturas de
 * correo de su organización (RF-14, CU-13). Las lecturas programadas no las pide una persona, así
 * que no están entre «las propias»: se listan aparte para poder abrirlas y revisar sus cobros.
 */
export function ImportacionesPage() {
  const cartolas = useListaDeImportaciones(getMisImportaciones, 'No pudimos cargar tus importaciones. Intenta de nuevo.');
  const lecturas = useListaDeImportaciones(getLecturasDeCorreo, 'No pudimos cargar las lecturas de correo. Intenta de nuevo.');

  return (
    <AppLayout headerTitulo="Importaciones" headerSubtitulo="Tus cartolas y lecturas de correo." angosto>
      <SubirArchivoCsv />
      <ListaDeImportaciones
        titulo="Tus cartolas"
        lista={cartolas}
        textoCargando="Cargando tus importaciones…"
        textoVerMas="Ver más"
        detalle={(cartola) => formatearFechaHora(cartola.creado_en)}
        sinImportaciones={
          <EmptyState
            icon={<FileSpreadsheet size={48} aria-hidden="true" />}
            title="Todavía no tienes importaciones"
            description="Cuando subas una cartola, aquí vas a ver cómo va."
          />
        }
      />
      <ListaDeImportaciones
        titulo="Lecturas de correo"
        lista={lecturas}
        textoCargando="Cargando las lecturas de correo…"
        textoVerMas="Ver más lecturas"
        detalle={detalleDeLectura}
        sinImportaciones={
          <p className={styles.mensaje}>
            Todavía no hay lecturas de correo. Aparecen aquí cuando revisamos una cuenta conectada en{' '}
            <Link to="/cuentas">Cuentas conectadas</Link>.
          </p>
        }
      />
    </AppLayout>
  );
}

/** Cuándo se leyó y, si la lectura se completó, cuántos cobros trae: solo en esas la página ofrece revisarlos. */
function detalleDeLectura(lectura: Importacion): string {
  const fecha = formatearFechaHora(lectura.creado_en);
  if (lectura.estado !== 'completada') return fecha;
  return `${fecha} · ${fraseDeCobros(lectura.candidatos_detectados)}`;
}

function fraseDeCobros(cantidad: number): string {
  if (cantidad === 0) return 'Sin cobros encontrados';
  return cantidad === 1 ? '1 cobro encontrado' : `${cantidad.toLocaleString('es-CL')} cobros encontrados`;
}

interface ListaDeImportacionesProps {
  titulo: string;
  lista: ReturnType<typeof useListaDeImportaciones>;
  textoCargando: string;
  textoVerMas: string;
  /** La segunda línea de cada fila. */
  detalle: (importacion: Importacion) => string;
  /** Lo que se muestra cuando el servidor responde que no hay ninguna. */
  sinImportaciones: ReactNode;
}

function ListaDeImportaciones({ titulo, lista, textoCargando, textoVerMas, detalle, sinImportaciones }: ListaDeImportacionesProps) {
  const idTitulo = useId();
  const { estado, verMas, reintentar } = lista;
  return (
    <section className={styles.seccion} aria-labelledby={idTitulo}>
      <h2 id={idTitulo} className={styles.tituloSeccion}>
        {titulo}
      </h2>
      {estado.tipo === 'cargando' && <p className={styles.mensaje}>{textoCargando}</p>}
      {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={reintentar} />}
      {estado.tipo === 'listo' && estado.importaciones.length === 0 && sinImportaciones}
      {estado.tipo === 'listo' && estado.importaciones.length > 0 && (
        <>
          <ul className={styles.lista}>
            {estado.importaciones.map((imp) => (
              <li key={imp.id}>
                <Link to={`/importaciones/${encodeURIComponent(imp.id)}`} className={`tile ${styles.itemLista}`}>
                  <span className={styles.itemTexto}>
                    <span className={styles.itemTitulo}>{imp.nombre_archivo || imp.origen_legible}</span>
                    <span className={styles.detalle}>{detalle(imp)}</span>
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
              {textoVerMas}
            </Boton>
          )}
        </>
      )}
    </section>
  );
}
