import type { ComparacionDePresupuesto } from '@ojoalgasto/shared';
import {
  anchoDeLaBarra,
  esMontoCero,
  montoDelServidor,
  montoSinSigno,
  nombreDelMes,
  porcentajeLegible,
  situacionDelPresupuesto,
} from './presentacionDePresupuesto';
import styles from './Presupuesto.module.css';

interface Cifra {
  titulo: string;
  ayuda: string;
  monto: string;
}

/**
 * S3-CH-27: lo que el servidor calculó para un mes y una moneda, tal cual. Ninguna cifra se
 * suma ni se compara aquí: el aviso de exceso es el `alerta_superado` del servidor, y lo que
 * queda o lo que sobra es su `diferencia`. Las tres situaciones que no deben confundirse:
 * sin presupuesto (hay gasto pero no hay con qué compararlo), gasto de cero (hay presupuesto
 * y no se ha gastado nada) y presupuesto superado.
 */
export function ComparacionDelPresupuesto({ comparacion }: { comparacion: ComparacionDePresupuesto }) {
  const { moneda, mes } = comparacion;
  const situacion = situacionDelPresupuesto(comparacion);
  const sinGasto = esMontoCero(comparacion.gasto_real) && esMontoCero(comparacion.gasto_proyectado);
  const cifras: Cifra[] = [
    { titulo: 'Gasto real', ayuda: 'Los cobros que ya se hicieron en el mes.', monto: comparacion.gasto_real },
    { titulo: 'Gasto proyectado', ayuda: 'Lo que falta por cobrar en el mes. Un mes que ya pasó no proyecta nada.', monto: comparacion.gasto_proyectado },
    { titulo: 'Total esperado', ayuda: 'El gasto real más el proyectado.', monto: comparacion.total_esperado },
  ];

  return (
    <div className={styles.comparacion}>
      {comparacion.presupuesto === null ? (
        <p className={styles.sinPresupuesto}>
          Aún no defines un presupuesto para {nombreDelMes(mes)} en {moneda}.
        </p>
      ) : (
        <>
          <p className={styles.montoDelPresupuesto}>
            {montoDelServidor(comparacion.presupuesto, moneda)}
            <span className={styles.sufijo}>de presupuesto</span>
          </p>
          <div
            className={styles.barra}
            role="progressbar"
            aria-label="Presupuesto consumido"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(anchoDeLaBarra(comparacion.porcentaje_consumido))}
            aria-valuetext={`${porcentajeLegible(comparacion.porcentaje_consumido)} del presupuesto`}
          >
            <div
              className={`${styles.barraLlena} ${situacion === 'presupuesto_superado' ? styles.barraSuperada : ''}`}
              style={{ width: `${anchoDeLaBarra(comparacion.porcentaje_consumido)}%` }}
            />
          </div>
          <p className={styles.porcentaje}>{porcentajeLegible(comparacion.porcentaje_consumido)} del presupuesto</p>
          {comparacion.diferencia !== null &&
            (situacion === 'presupuesto_superado' ? (
              <p className={styles.superado}>
                Entre lo cobrado y lo que falta por cobrar, superas el presupuesto por {montoDelServidor(montoSinSigno(comparacion.diferencia), moneda)}.
              </p>
            ) : (
              <p className={styles.dentro}>Te quedan {montoDelServidor(comparacion.diferencia, moneda)} del presupuesto.</p>
            ))}
        </>
      )}

      {sinGasto && (
        <p className={styles.sinGasto}>
          Sin gasto en {nombreDelMes(mes)}: no hay cobros ni cobros por venir en {moneda}.
        </p>
      )}

      <dl className={styles.cifras}>
        {cifras.map((cifra) => (
          <div key={cifra.titulo} className={styles.cifra}>
            <dt>{cifra.titulo}</dt>
            <dd>{montoDelServidor(cifra.monto, moneda)}</dd>
            <dd className={styles.ayuda}>{cifra.ayuda}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
