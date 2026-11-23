import {
  formatearMonto,
  gastosConMovimiento,
  NOMBRE_DE_ESTADO,
  textoDelResumen,
  type ResumenDelPeriodo as Resumen,
} from '@ojoalgasto/shared';
import { Seccion } from '../ui/Seccion';
import styles from './Informes.module.css';

/**
 * El resumen de un mes ya cargado (AN-22). Cada moneda va en su propia fila: los importes de monedas
 * distintas nunca se suman. La tabla y el texto de abajo son la alternativa legible a cualquier gráfico.
 */
export function ResumenDelPeriodo({ resumen }: { resumen: Resumen }) {
  const gastos = gastosConMovimiento(resumen);

  return (
    <>
      <Seccion titulo="Gasto del periodo" tinte="turquesa">
        {gastos.length === 0 ? (
          <p className={styles.mensaje}>Sin gastos registrados ni proyectados en este periodo.</p>
        ) : (
          <table className={styles.tabla}>
            <caption>Gasto por moneda. Cada moneda se muestra por separado.</caption>
            <thead>
              <tr>
                <th scope="col">Moneda</th>
                <th scope="col">Gastado</th>
                <th scope="col">Por cobrar</th>
                <th scope="col">Total estimado</th>
              </tr>
            </thead>
            <tbody>
              {gastos.map((gasto) => (
                <tr key={gasto.moneda}>
                  <th scope="row">{gasto.moneda}</th>
                  <td>{formatearMonto(gasto.gastoReal, gasto.moneda)}</td>
                  <td>{formatearMonto(gasto.gastoProyectado, gasto.moneda)}</td>
                  <td className={styles.total}>{formatearMonto(gasto.totalEstimado, gasto.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {gastos.length > 0 && (
          <p className={styles.nota}>«Gastado» cuenta solo los cobros de suscripciones que siguen activas.</p>
        )}
      </Seccion>

      <Seccion titulo={`Suscripciones: ${resumen.conteo.total}`} tinte="azul">
        <ul className={styles.conteo} aria-label="Suscripciones por estado">
          {(Object.keys(NOMBRE_DE_ESTADO) as (keyof typeof NOMBRE_DE_ESTADO)[]).map((estado) => (
            <li key={estado} className={styles.conteoItem}>
              <span className={styles.conteoNumero}>{resumen.conteo[estado]}</span>
              <span className={styles.conteoNombre}>{NOMBRE_DE_ESTADO[estado]}</span>
            </li>
          ))}
        </ul>
      </Seccion>

      <Seccion titulo="Resumen en texto">
        <p className={styles.texto}>{textoDelResumen(resumen)}</p>
      </Seccion>
    </>
  );
}
