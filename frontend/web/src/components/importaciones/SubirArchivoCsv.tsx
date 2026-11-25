import {
  ErrorDeApi,
  subirArchivoImportacion,
  validarArchivoCsv,
  type Importacion,
} from '@ojoalgasto/shared';
import { Upload } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import { Boton } from '../ui/Boton';
import styles from './SubirArchivoCsv.module.css';

export interface SubirArchivoCsvProps {
  /** Función que sube el archivo. Por omisión llama a subirArchivoImportacion de @ojoalgasto/shared. */
  onSubir?: (archivo: File) => Promise<Importacion>;
  /** Acción al recibir la importación creada. Por omisión navega a /importaciones/:id. */
  onExito?: (importacion: Importacion) => void;
}

/**
 * Selector y envío de archivo CSV para importación (S3-SE-02, S3-SE-03, FE-07).
 * Valida tipo y tamaño en el cliente antes de subir, permite corregir,
 * conecta el multipart POST /api/importaciones/archivos/ con el id devuelto,
 * redirige al progreso sin afirmar éxito prematuro y aísla por sesión.
 */
export function SubirArchivoCsv({ onSubir, onExito }: SubirArchivoCsvProps) {
  const navigate = useNavigate();
  const { capturarSesion } = useAuth();
  const [archivo, setArchivo] = useState<File | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const montadoRef = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  async function manejarEnvio(evento: FormEvent) {
    evento.preventDefault();
    if (!archivo || cargando) return;

    // Validación preventiva en cliente (S3-SE-03): archivos incompatibles no se envían.
    const validacion = validarArchivoCsv(archivo);
    if (!validacion.valido) {
      setError(validacion.error ?? 'Archivo incompatible.');
      return;
    }

    setError('');
    setCargando(true);
    const sesionAlIniciar = capturarSesion();

    try {
      const subir = onSubir ?? ((f: File) => subirArchivoImportacion(f, f.name));
      const importacion = await subir(archivo);

      // Si el componente se desmontó o cambió de sesión en vuelo, se descarta.
      if (!montadoRef.current || capturarSesion() !== sesionAlIniciar) {
        return;
      }

      if (onExito) {
        onExito(importacion);
      } else {
        navigate(`/importaciones/${encodeURIComponent(importacion.id)}`);
      }
    } catch (err: unknown) {
      if (!montadoRef.current || capturarSesion() !== sesionAlIniciar) {
        return;
      }

      if (err instanceof TypeError) {
        setError(MENSAJE_SIN_RED);
      } else if (err instanceof ErrorDeApi) {
        setError(err.message);
      } else {
        setError('No pudimos subir el archivo. Intenta de nuevo.');
      }
    } finally {
      if (montadoRef.current && capturarSesion() === sesionAlIniciar) {
        setCargando(false);
      }
    }
  }

  function alCambiarArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const seleccionado = e.target.files?.[0] ?? null;
    if (!seleccionado) {
      setArchivo(null);
      setError('');
      return;
    }

    const validacion = validarArchivoCsv(seleccionado);
    setArchivo(seleccionado);
    if (!validacion.valido) {
      setError(validacion.error ?? 'Archivo incompatible.');
    } else {
      setError('');
    }
  }

  const esValido = Boolean(archivo && !error);

  return (
    <section className={styles.contenedor} aria-labelledby="titulo-subir-csv">
      <div className={styles.encabezado}>
        <h2 id="titulo-subir-csv" className={styles.titulo}>
          Subir cartola o archivo CSV
        </h2>
        <p className={styles.descripcion}>
          Carga un archivo con tus movimientos bancarios para detectar suscripciones y cobros periódicos.
        </p>
      </div>

      <form onSubmit={manejarEnvio} className={styles.formulario}>
        <div className={styles.selectorFila}>
          <input
            ref={inputRef}
            type="file"
            id="archivo-csv"
            accept=".csv,text/csv"
            aria-label="Seleccionar archivo CSV"
            disabled={cargando}
            onChange={alCambiarArchivo}
            className={styles.inputArchivo}
          />
          <Boton
            type="submit"
            variante="primario"
            tamano="s"
            cargando={cargando}
            disabled={!esValido || cargando}
            icono={<Upload size={14} aria-hidden="true" />}
          >
            Subir archivo
          </Boton>
        </div>

        {error && (
          <p role="alert" className={styles.error}>
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
