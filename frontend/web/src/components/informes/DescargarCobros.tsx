import { rangoDelMes } from '@ojoalgasto/shared';
import { Download } from 'lucide-react';
import { useDescargaDeCobros } from '../../hooks/useDescargaDeCobros';
import { Boton } from '../ui/Boton';
import { Seccion } from '../ui/Seccion';
import styles from './Informes.module.css';
import { nombreDelArchivoDeCobros, nombreDelMes } from './periodosDeInforme';

/**
 * S3-CH-25: el CSV de los cobros del mes y la moneda que se están viendo (VI-25). Lo arma el
 * servidor con todos los cobros del rango, no con la página de datos que haya en pantalla. No
 * es la exportación de datos personales (S3-CH-26): solo trae cobros.
 */
export function DescargarCobros({ mes, moneda }: { mes: string; moneda: string }) {
  const { desde, hasta } = rangoDelMes(mes);
  const { enCurso, resultado, descargar } = useDescargaDeCobros(
    { desde, hasta, moneda },
    nombreDelArchivoDeCobros(mes, moneda),
  );

  return (
    <Seccion
      titulo="Descargar cobros"
      descripcion={`Un archivo CSV con todos los cobros de ${nombreDelMes(mes)} en ${moneda}, uno por fila.`}
    >
      <div className={styles.descarga}>
        <Boton
          variante="secundario"
          icono={<Download size={16} aria-hidden="true" />}
          cargando={enCurso}
          onClick={() => void descargar()}
        >
          {enCurso ? 'Descargando…' : 'Descargar CSV'}
        </Boton>
        {resultado?.tipo === 'lista' && (
          <p role="status" className={styles.avisoDescarga}>
            Descargamos {resultado.nombre}.
          </p>
        )}
        {resultado?.tipo === 'error' && (
          <p role="alert" className={styles.avisoDescarga}>
            {resultado.mensaje}
          </p>
        )}
      </div>
    </Seccion>
  );
}
