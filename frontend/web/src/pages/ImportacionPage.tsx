import { formatearFechaHora, type EstadoImportacion, type Importacion } from '@ojoalgasto/shared';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia, type TonoInsignia } from '../components/ui/Insignia';
import { useProgresoImportacion } from '../hooks/useProgresoImportacion';
import styles from './ImportacionesPage.module.css';

export const TONO_ESTADO: Record<EstadoImportacion, TonoInsignia> = {
  pendiente: 'neutro',
  procesando: 'acento',
  completada: 'verde',
  fallida: 'coral',
};

/**
 * Progreso de una importación (CH-27), con el id que entrega FE-07 al subir
 * un archivo o FE-13 al leer el correo: /importaciones/<id>.
 */
export function ImportacionPage() {
  const { id } = useParams<{ id: string }>();
  const { estado, reintentar } = useProgresoImportacion(id);

  return (
    <AppLayout headerTitulo="Importación" headerSubtitulo="Cómo va la lectura de tu archivo o tu correo." angosto>
      <Link to="/importaciones" className={styles.volver}>
        <ArrowLeft size={15} aria-hidden="true" />
        Tus importaciones
      </Link>

      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Consultando la importación…</p>}
      {estado.tipo === 'no-encontrada' && (
        <p className={styles.mensaje}>No encontramos esta importación. Revisa que el enlace esté completo.</p>
      )}
      {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={reintentar} />}
      {estado.tipo === 'listo' && (
        <DetalleImportacion importacion={estado.importacion} problema={estado.problema} onReintentar={reintentar} />
      )}
    </AppLayout>
  );
}

interface DetalleImportacionProps {
  importacion: Importacion;
  problema: null | 'reintentando' | 'detenido';
  onReintentar: () => void;
}

function DetalleImportacion({ importacion: imp, problema, onReintentar }: DetalleImportacionProps) {
  return (
    <section className={`tile ${styles.tarjeta}`} aria-labelledby="titulo-importacion">
      <div className={styles.encabezado}>
        <h2 id="titulo-importacion" className={styles.titulo}>
          {imp.nombre_archivo || imp.origen_legible}
        </h2>
        <Insignia tono={TONO_ESTADO[imp.estado]}>{imp.estado_legible}</Insignia>
      </div>
      <p className={styles.detalle}>
        {imp.origen_legible} · empezó el {formatearFechaHora(imp.creado_en)}
      </p>

      {/* Se anuncia solo cuando cambia el estado, no a cada fila. */}
      <p className={styles.resumen} aria-live="polite">
        {resumen(imp)}
      </p>

      {!imp.terminada && <BarraProgreso importacion={imp} />}

      {problema === 'reintentando' && (
        <p className={styles.detalle} role="status">
          No pudimos consultar el avance. Seguimos intentando…
        </p>
      )}
      {problema === 'detenido' && (
        <ErrorConReintento
          mensaje="Dejamos de consultar porque no hubo respuesta. Lo que ves puede estar desactualizado."
          onReintentar={onReintentar}
        />
      )}

      {imp.estado === 'completada' && <Candidatos importacion={imp} />}
      {imp.errores_totales > 0 && <ErroresPorFila importacion={imp} />}
    </section>
  );
}

/** Qué está pasando, en una frase. Nunca dice "importado": eso recién pasa al confirmar (FE-11). */
function resumen(imp: Importacion): string {
  switch (imp.estado) {
    case 'pendiente':
      return 'En cola: empieza en unos momentos.';
    case 'procesando':
      return imp.origen === 'correo' ? 'Leyendo tus correos…' : 'Leyendo el archivo…';
    case 'completada':
      return 'El análisis terminó.';
    case 'fallida':
      return 'La importación no se pudo terminar. No se creó ni cambió ninguna suscripción.';
  }
}

function BarraProgreso({ importacion: imp }: { importacion: Importacion }) {
  // null no es 0: todavía no se sabe cuántas filas hay, y la barra no inventa un avance.
  const conocido = imp.progreso !== null;
  // En una lectura de correo, cada "fila" de FE-08 es un mensaje.
  const correo = imp.origen === 'correo';
  const texto = conocido
    ? `${imp.filas_procesadas.toLocaleString('es-CL')} de ${(imp.filas_totales ?? 0).toLocaleString('es-CL')} ${correo ? 'mensajes' : 'filas'} (${imp.progreso} %)`
    : correo
      ? 'Todavía no sabemos cuántos mensajes son.'
      : 'Todavía no sabemos cuántas filas son.';
  return (
    <div className={styles.progreso}>
      <div
        role="progressbar"
        aria-label="Avance de la importación"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={conocido ? (imp.progreso ?? undefined) : undefined}
        aria-valuetext={texto}
        className={conocido ? styles.barra : `${styles.barra} ${styles.barraIndeterminada}`}
      >
        <span className={styles.relleno} style={conocido ? { width: `${imp.progreso}%` } : undefined} />
      </div>
      <p className={styles.detalle}>{texto}</p>
    </div>
  );
}

function Candidatos({ importacion: imp }: { importacion: Importacion }) {
  const n = imp.candidatos_detectados;
  if (imp.candidatos_confirmados) {
    return (
      <p className={styles.candidatos}>
        Confirmaste estos cobros{imp.confirmada_en ? ` el ${formatearFechaHora(imp.confirmada_en)}` : ''}.
      </p>
    );
  }
  if (n === 0) {
    return <p className={styles.candidatos}>No encontramos cobros que parezcan suscripciones.</p>;
  }
  return (
    <div className={styles.candidatos}>
      <p>
        Encontramos {n === 1 ? '1 cobro posible' : `${n.toLocaleString('es-CL')} cobros posibles`}.{' '}
        <strong>Todavía no se creó ni cambió ninguna suscripción:</strong> primero los revisas y los confirmas.
      </p>
      {/* El paso a la previsualización (FE-10) todavía no existe en la web. */}
      <Boton variante="secundario" tamano="s" disabled title="Muy pronto">
        Revisar cobros encontrados
      </Boton>
    </div>
  );
}

function ErroresPorFila({ importacion: imp }: { importacion: Importacion }) {
  const resto = imp.errores_totales - imp.errores.length;
  return (
    <div className={styles.errores}>
      <h3 className={styles.subtitulo}>
        {imp.errores_totales === 1 ? '1 problema' : `${imp.errores_totales.toLocaleString('es-CL')} problemas`}
      </h3>
      <ul className={styles.listaErrores}>
        {imp.errores.map((e, i) => (
          <li key={`${e.fila ?? 'x'}-${i}`}>
            {typeof e.fila === 'number' && <span className={styles.fila}>Fila {e.fila}</span>}
            {e.mensaje}
          </li>
        ))}
      </ul>
      {/* FE-08 guarda solo los primeros; el total es el real. */}
      {resto > 0 && <p className={styles.detalle}>Y {resto.toLocaleString('es-CL')} más.</p>}
    </div>
  );
}
