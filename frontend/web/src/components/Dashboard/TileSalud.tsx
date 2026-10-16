import { equivalenteMensual, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Ghost, Leaf, Timer } from 'lucide-react';
import { useConteo } from '../../hooks/useConteo';
import { Anillo } from './Medidores';
import styles from './Tiles.module.css';

interface TileSaludProps {
  suscripciones: Suscripcion[];
}

/**
 * Qué parte de lo que pagas, usas. Como el medidor de calidad del aire:
 * un anillo con el porcentaje, dos datos al lado y un veredicto en una
 * frase. El anillo es verde cuando casi todo se usa y coral cuando la
 * fuga pesa (más del 10 % del gasto en fantasmas, RN-REC-002).
 */
export function TileSalud({ suscripciones }: TileSaludProps) {
  let total = 0;
  let sinUso = 0;
  let fantasmas = 0;
  let pruebas = 0;
  for (const s of suscripciones) {
    const mensual = equivalenteMensual(s.monto, s.frecuencia);
    if (s.estado === 'activo') total += mensual;
    if (s.estado === 'fantasma') {
      total += mensual;
      sinUso += mensual;
      fantasmas += 1;
    }
    if (s.estado === 'prueba') pruebas += 1;
  }
  const enUso = total > 0 ? Math.round(((total - sinUso) / total) * 100) : 100;
  const fuga = total > 0 ? sinUso / total : 0;
  const sano = fuga <= 0.1;
  const color = sano ? 'var(--verde)' : 'var(--coral)';
  // El número sube al mismo ritmo que se llena el anillo.
  const enUsoMostrado = Math.round(useConteo(enUso, 900));

  // Barras decorativas: cuántas de cada 12 son fantasma, para que se vea la proporción.
  const barrasCoral = total > 0 ? Math.round(fuga * 12) : 0;

  return (
    <section className={`tile ${styles.tile} ${sano ? styles.tinteVerde : styles.tinteCoral}`} aria-label="Salud del gasto">
      <div className={styles.cabecera}>
        <span className={styles.icono} style={{ color }}>
          <Leaf size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Salud del gasto</h2>
          <p className={styles.subtitulo}>Lo que pagas y sí usas</p>
        </div>
        <span className={styles.pill} style={{ color }}>
          {sano ? 'Sano' : 'Con fuga'}
        </span>
      </div>

      <div className={styles.saludCuerpo}>
        <Anillo porcentaje={enUso} color={color} tamano={132} etiqueta={`${enUso} % del gasto en uso`}>
          <span className={styles.saludCifra}>
            {enUsoMostrado}
            <span className={styles.saludCifraSufijo}>%</span>
          </span>
          <span className={styles.saludEtiqueta}>en uso</span>
        </Anillo>

        <div className={styles.saludLado}>
          <div className={styles.saludDato}>
            <span className={styles.saludDatoIcono} style={{ color: 'var(--coral)' }}>
              <Ghost size={16} aria-hidden="true" />
            </span>
            <span className={styles.saludDatoTexto}>
              <span className={styles.saludDatoEtiqueta}>Sin uso</span>
              <span className={styles.saludDatoValor}>
                {formatearMonto(sinUso)} {fantasmas > 0 && `(${fantasmas})`}
              </span>
            </span>
          </div>
          <div className={styles.saludDato}>
            <span className={styles.saludDatoIcono} style={{ color: 'var(--turquesa)' }}>
              <Timer size={16} aria-hidden="true" />
            </span>
            <span className={styles.saludDatoTexto}>
              <span className={styles.saludDatoEtiqueta}>Pruebas gratis</span>
              <span className={styles.saludDatoValor}>{pruebas}</span>
            </span>
          </div>
          <div className={styles.saludBarras} aria-hidden="true">
            {Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                className={`${styles.saludBarra} ${i >= 12 - barrasCoral ? styles.saludBarraCoral : ''}`}
                style={{ height: `${40 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>
      </div>

      <p className={`${styles.saludVeredicto} ${sano ? '' : styles.saludVeredictoCoral}`}>
        {total === 0
          ? 'Todavía no hay gasto que medir.'
          : sano
            ? 'Casi todo lo que pagas, lo usas.'
            : 'Hay plata que se va sin que nadie la use.'}
      </p>
    </section>
  );
}
