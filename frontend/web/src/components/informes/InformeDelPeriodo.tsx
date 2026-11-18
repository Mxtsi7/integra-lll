import type { CargaInforme } from '../../hooks/useInformeMensual';
import { Spinner } from '../Spinner';
import { ErrorConReintento } from '../ui/ErrorConReintento';
import { DescargarCobros } from './DescargarCobros';
import { GraficoDeGastos } from './GraficoDeGastos';
import styles from './Informes.module.css';
import { MESES_DEL_INFORME, sinGastos } from './periodosDeInforme';
import { ResumenDelPeriodo } from './ResumenDelPeriodo';

interface InformeDelPeriodoProps {
  carga: CargaInforme;
  /** El mes elegido, "YYYY-MM". */
  mes: string;
  moneda: string;
  onReintentar: () => void;
}

/**
 * S3-CH-25: lo que muestra Informes según cómo vaya la carga: cargando, error con reintento, vacío
 * o el informe. Solo dibuja lo que le llega; los datos los pide useInformeMensual.
 */
export function InformeDelPeriodo({ carga, mes, moneda, onReintentar }: InformeDelPeriodoProps) {
  if (carga.tipo === 'cargando') {
    return (
      <div className={styles.estadoCarga}>
        <Spinner size={18} etiqueta="Cargando tus gastos" />
      </div>
    );
  }
  if (carga.tipo === 'error') return <ErrorConReintento mensaje={carga.mensaje} onReintentar={onReintentar} />;
  if (sinGastos(carga.meses)) {
    return (
      <p className={styles.vacio}>
        No hay cobros en {moneda} en los últimos {MESES_DEL_INFORME} meses. Prueba con otra moneda o con otro mes.
      </p>
    );
  }

  const delMes = carga.meses[carga.meses.length - 1];
  return (
    <>
      <ResumenDelPeriodo resumen={delMes} />
      <GraficoDeGastos meses={carga.meses} mesElegido={mes} />
      <DescargarCobros mes={mes} moneda={moneda} />
    </>
  );
}
