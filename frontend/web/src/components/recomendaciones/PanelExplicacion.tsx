import type { EstadoExplicacion } from '../../hooks/useRecomendaciones';
import { Boton } from '../ui/Boton';
import styles from './PanelExplicacion.module.css';

/** Lo que se dice si el backend no trae un texto que mostrar: no se escribe uno en su lugar. */
const MENSAJE_SIN_EXPLICACION = 'No hay una explicación disponible para esta recomendación.';

interface PanelExplicacionProps {
  /** Lo apunta con aria-controls el botón que abre el panel. */
  idPanel: string;
  /** Sin entrada: se abrió y todavía no se pidió. */
  estado: EstadoExplicacion | undefined;
  alReintentar: () => void;
}

/** Un texto de la API sin espacios de más; si no es un texto, vacío. */
function textoDe(valor: unknown): string {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * CH-22: la explicación de una recomendación (MX-25). El texto lo arma el
 * backend con los hechos guardados; acá no se agrega ni se completa nada.
 */
export function PanelExplicacion({ idPanel, estado, alReintentar }: PanelExplicacionProps) {
  return (
    <div id={idPanel} className={styles.panel}>
      <ContenidoExplicacion estado={estado} alReintentar={alReintentar} />
    </div>
  );
}

function ContenidoExplicacion({ estado, alReintentar }: Pick<PanelExplicacionProps, 'estado' | 'alReintentar'>) {
  if (estado === undefined || estado.tipo === 'cargando') {
    return (
      <p role="status" className={styles.mensaje}>
        Cargando explicación…
      </p>
    );
  }

  if (estado.tipo === 'error') {
    return (
      <>
        <p role="alert" className={styles.error}>
          {estado.mensaje}
        </p>
        <div>
          <Boton variante="sutil" tamano="s" onClick={alReintentar}>
            Reintentar
          </Boton>
        </div>
      </>
    );
  }

  const { explicacion } = estado;
  const texto = textoDe(explicacion.explicacion);
  if (texto === '') return <p className={styles.mensaje}>{MENSAJE_SIN_EXPLICACION}</p>;

  // Sin datos suficientes el backend lo explica con su propio texto, y no hay estimación que advertir.
  if (explicacion.estado === 'datos_insuficientes') return <p className={styles.sinDatos}>{texto}</p>;

  const advertenciaDeUso = textoDe(explicacion.advertencia_uso);
  return (
    <>
      <p className={styles.texto}>{texto}</p>
      {advertenciaDeUso !== '' && <p className={styles.aviso}>{advertenciaDeUso}</p>}
    </>
  );
}
