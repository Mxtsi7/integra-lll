import type { ResumenDelMes } from '@ojoalgasto/shared';
import styles from './Informes.module.css';
import { montoLegible } from './periodosDeInforme';

interface Cifra {
  titulo: string;
  ayuda: string;
  monto: string;
}

/**
 * S3-CH-25: las tres cifras del mes elegido, tal cual las calcula el servidor (VI-06) para
 * toda la organización: ninguna se suma aquí sobre una página de datos.
 */
export function ResumenDelPeriodo({ resumen }: { resumen: ResumenDelMes }) {
  const cifras: Cifra[] = [
    { titulo: 'Gasto real', ayuda: 'Los cobros que ya se hicieron en el mes, de las suscripciones que siguen activas.', monto: resumen.gasto_real },
    { titulo: 'Gasto proyectado', ayuda: 'Lo que falta por cobrar en el mes. Un mes que ya pasó no proyecta nada.', monto: resumen.gasto_proyectado },
    { titulo: 'Total estimado', ayuda: 'El gasto real más el proyectado.', monto: resumen.total_estimado },
  ];
  return (
    <section className={styles.resumen} aria-label="Resumen del mes">
      {cifras.map((cifra) => (
        <div key={cifra.titulo} className={`tile ${styles.cifra}`}>
          <p className={styles.cifraTitulo}>{cifra.titulo}</p>
          <p className={styles.cifraValor}>{montoLegible(cifra.monto, resumen.moneda)}</p>
          <p className={styles.cifraAyuda}>{cifra.ayuda}</p>
        </div>
      ))}
    </section>
  );
}
