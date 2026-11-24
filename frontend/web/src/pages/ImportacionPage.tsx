import { formatearFechaHora, type EstadoImportacion, type Importacion } from '@ojoalgasto/shared';
import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { CobrosDeLaImportacion } from '../components/candidatos/CobrosDeLaImportacion';
import { AppLayout } from '../components/layout/AppLayout';
import { Boton, BotonEnlace } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Insignia, type TonoInsignia } from '../components/ui/Insignia';
import { hayQueReconectar, type EstadoCuentaDeImportacion } from '../components/importacion/reconexion';
import { useCuentaDeImportacion } from '../hooks/useCuentaDeImportacion';
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
  // Solo una importación de correo tiene cuenta, y solo se consulta cuando ya terminó: la lectura marca la cuenta
  // justo cuando falla, así que lo que diga mientras sigue en curso puede cambiar antes del final.
  const cuentaDeLaImportacion = estado.tipo === 'listo' && estado.importacion.terminada ? (estado.importacion.cuenta ?? null) : null;
  const estadoCuenta = useCuentaDeImportacion(cuentaDeLaImportacion);

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
        <DetalleImportacion
          importacion={estado.importacion}
          problema={estado.problema}
          onReintentar={reintentar}
          cuenta={estadoCuenta}
        />
      )}
    </AppLayout>
  );
}

interface DetalleImportacionProps {
  importacion: Importacion;
  problema: null | 'reintentando' | 'detenido';
  onReintentar: () => void;
  cuenta: EstadoCuentaDeImportacion;
}

function DetalleImportacion({ importacion: imp, problema, onReintentar, cuenta }: DetalleImportacionProps) {
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
      {hayQueReconectar(imp, cuenta) && <AvisoDeReconexion cuenta={cuenta} />}
      {/* S3-CH-06: lo que sí se leyó, aparte de lo que no. Cada bloque con lo suyo, y los dos se ven a la vez. */}
      {imp.estado === 'completada' && imp.candidatos_detectados > 0 && (
        <div className={styles.cobros}>
          <h3 className={styles.subtitulo}>Cobros encontrados</h3>
          <CobrosDeLaImportacion importacionId={imp.id} />
        </div>
      )}
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
  const anterior = imp.candidatos_detectados;
  // Una reimportación cuenta solo los cobros nuevos: lo que no es cobro ni error ya estaba importado (doc 22).
  const yaImportadas = imp.origen === 'csv' ? Math.max(0, (imp.filas_totales ?? 0) - anterior - imp.errores_totales) : 0;
  const avisoYaImportadas =
    yaImportadas === 1
      ? '1 fila ya estaba importada de antes: no se repite.'
      : `${yaImportadas.toLocaleString('es-CL')} filas ya estaban importadas de antes: no se repiten.`;
  if (imp.candidatos_confirmados) {
    return (
      <p className={styles.candidatos}>
        Confirmaste estos cobros{imp.confirmada_en ? ` el ${formatearFechaHora(imp.confirmada_en)}` : ''}.
      </p>
    );
  }
  if (anterior === 0) {
    return (
      <p className={styles.candidatos}>
        {yaImportadas > 0 ? avisoYaImportadas : 'No encontramos cobros que parezcan suscripciones.'}
      </p>
    );
  }
  return (
    <div className={styles.candidatos}>
      <p>
        Encontramos {anterior === 1 ? '1 cobro posible' : `${anterior.toLocaleString('es-CL')} cobros posibles`}.{' '}
        <strong>Todavía no se creó ni cambió ninguna suscripción:</strong> primero los revisas y los confirmas.
      </p>
      {yaImportadas > 0 && <p>{avisoYaImportadas}</p>}
      {/* El paso a la previsualización (FE-10) todavía no existe en la web. */}
      <Boton variante="secundario" tamano="s" disabled title="Muy pronto">
        Revisar cobros encontrados
      </Boton>
    </div>
  );
}

/** S3-CH-22: la cuenta necesita que la vuelvan a autorizar. Eso se hace en Cuentas conectadas. */
function AvisoDeReconexion({ cuenta }: { cuenta: EstadoCuentaDeImportacion }) {
  const proveedor = cuenta.tipo === 'listo' && cuenta.cuenta !== null ? cuenta.cuenta.proveedor_legible : null;
  return (
    <div className={styles.reconexion}>
      <p>
        {proveedor ? `Tu cuenta de ${proveedor}` : 'Tu cuenta de correo'} necesita que la vuelvas a autorizar.
        Mientras tanto no podemos leer tus correos.
      </p>
      <BotonEnlace to="/cuentas" variante="secundario" tamano="s">
        Revisar cuentas conectadas
      </BotonEnlace>
    </div>
  );
}

function ErroresPorFila({ importacion: imp }: { importacion: Importacion }) {
  const resto = imp.errores_totales - imp.errores.length;
  // Un archivo se corrige y se vuelve a subir; una lectura de correo no tiene nada que corregir.
  const sePuedeCorregir = imp.origen === 'csv';
  return (
    <div className={styles.errores}>
      <h3 className={styles.subtitulo}>
        {imp.errores_totales === 1 ? '1 problema' : `${imp.errores_totales.toLocaleString('es-CL')} problemas`}
      </h3>
      {/* Un cobro que ya se encontró no se duplica: su identificador depende del cobro, no del archivo. */}
      {sePuedeCorregir && (
        <p className={styles.detalle}>
          Corrige estas filas en tu archivo y vuelve a subirlo: un cobro que ya se encontró no se duplica.
        </p>
      )}
      <ul className={styles.listaErrores}>
        {imp.errores.map((error, indice) => (
          <li key={`${error.fila ?? 'x'}-${indice}`}>
            {typeof error.fila === 'number' && <span className={styles.fila}>Fila {error.fila}</span>}
            {error.mensaje}
          </li>
        ))}
      </ul>
      {/* FE-08 guarda solo los primeros; el total es el real. */}
      {resto > 0 && <p className={styles.detalle}>Y {resto.toLocaleString('es-CL')} más.</p>}
      {resto > 0 && sePuedeCorregir && (
        <p className={styles.detalle}>
          Aquí solo ves las primeras filas con problemas. Cuando corrijas estas y vuelvas a subir el archivo, verás las que falten.
        </p>
      )}
    </div>
  );
}
