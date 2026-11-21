import { conMayuscula, type ResumenDelMes } from '@ojoalgasto/shared';
import { Seccion } from '../ui/Seccion';
import styles from './Informes.module.css';
import { etiquetaCortaDelMes, montoComoNumero, montoLegible, nombreDelMes } from './periodosDeInforme';

interface GraficoDeGastosProps {
  /** Un resumen por mes, del más antiguo al más nuevo, todos de la misma moneda. */
  meses: readonly ResumenDelMes[];
  /** El mes elegido, "YYYY-MM": va destacado. */
  mesElegido: string;
}

/**
 * S3-CH-25: el gasto de los últimos meses, real y proyectado, con las mismas respuestas
 * del servidor que las cifras de arriba. El dibujo es solo una ayuda: la tabla de abajo
 * trae cada número, y es lo que lee un lector de pantalla.
 */
export function GraficoDeGastos({ meses, mesElegido }: GraficoDeGastosProps) {
  const moneda = meses[0]?.moneda ?? '';
  const sumas = meses.map((mes) => montoComoNumero(mes.gasto_real) + montoComoNumero(mes.gasto_proyectado));
  const maximo = Math.max(0, ...sumas);
  const primero = meses[0]?.periodo ?? mesElegido;
  const ultimo = meses[meses.length - 1]?.periodo ?? mesElegido;

  return (
    <Seccion titulo="Gasto por mes" descripcion={`Los últimos ${meses.length} meses en ${moneda}, hasta ${nombreDelMes(ultimo)}.`}>
      <figure className={styles.grafico}>
        <div
          className={styles.barras}
          role="img"
          aria-label={`Gasto estimado por mes en ${moneda}, de ${nombreDelMes(primero)} a ${nombreDelMes(ultimo)}. Cada valor está en la tabla de abajo.`}
        >
          {meses.map((mes, posicion) => {
            // Un mes con gasto siempre se ve, aunque sea mínimo al lado del más alto.
            const alto = maximo === 0 || sumas[posicion] === 0 ? 0 : Math.max(2, Math.round((sumas[posicion] / maximo) * 100));
            return (
              <div key={mes.periodo} className={`${styles.columna} ${mes.periodo === mesElegido ? styles.columnaElegida : ''}`}>
                <div className={styles.pila} style={{ height: `${alto}%` }}>
                  <span className={styles.real} style={{ flexGrow: montoComoNumero(mes.gasto_real) }} />
                  <span className={styles.proyectado} style={{ flexGrow: montoComoNumero(mes.gasto_proyectado) }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className={styles.etiquetas} aria-hidden="true">
          {meses.map((mes) => (
            <span key={mes.periodo} className={mes.periodo === mesElegido ? styles.etiquetaElegida : ''}>
              {etiquetaCortaDelMes(mes.periodo)}
            </span>
          ))}
        </div>
        <figcaption className={styles.leyenda} aria-hidden="true">
          <span className={styles.claveReal}>Real</span>
          <span className={styles.claveProyectado}>Proyectado</span>
        </figcaption>
      </figure>

      <table className={styles.tabla}>
        <caption className={styles.tablaTitulo}>Detalle por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Gasto real</th>
            <th scope="col">Gasto proyectado</th>
            <th scope="col">Total estimado</th>
          </tr>
        </thead>
        <tbody>
          {meses.map((mes) => (
            <tr key={mes.periodo} aria-current={mes.periodo === mesElegido ? 'true' : undefined}>
              <th scope="row">{conMayuscula(nombreDelMes(mes.periodo))}</th>
              <td>{montoLegible(mes.gasto_real, mes.moneda)}</td>
              <td>{montoLegible(mes.gasto_proyectado, mes.moneda)}</td>
              <td>{montoLegible(mes.total_estimado, mes.moneda)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Seccion>
  );
}
