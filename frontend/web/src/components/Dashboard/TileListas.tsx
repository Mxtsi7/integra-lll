import { formatearFecha, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { Ghost, Timer } from 'lucide-react';
import { Link } from 'react-router-dom';
import { diasHasta } from '../../utils/fechas';
import { CATEGORIA_VISUAL, cuandoEnDias, sufijoFrecuencia } from '../subscriptions/presentacion';
import styles from './Tiles.module.css';

/**
 * Las que siguen cobrando sin que nadie las use (RN-REC-002: 45 días o más
 * sin actividad). El interruptor encendido dice justo eso: sigue cobrando.
 */
export function TileFantasmas({ suscripciones }: { suscripciones: Suscripcion[] }) {
  const fantasmas = suscripciones.filter((s) => s.estado === 'fantasma');

  return (
    <section className={`tile ${styles.tile} ${styles.tinteCoral}`} aria-label="Suscripciones sin uso">
      <div className={styles.cabecera}>
        <span className={styles.icono} style={{ color: 'var(--coral)' }}>
          <Ghost size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Sin uso</h2>
          <p className={styles.subtitulo}>Más de 45 días sin actividad</p>
        </div>
      </div>

      {fantasmas.length === 0 ? (
        <p className={styles.vacio}>Ninguna. Todo lo que pagas se usa.</p>
      ) : (
        <ul className={styles.lista}>
          {fantasmas.map((s) => {
            const { Icono, color } = CATEGORIA_VISUAL[s.categoria];
            return (
              <li key={s.id}>
                <Link to={`/suscripciones/${s.id}`} className={styles.fila} title={s.nombre}>
                  <span className={styles.filaIcono} style={{ color }}>
                    <Icono size={16} aria-hidden="true" />
                  </span>
                  <span className={styles.filaTexto}>
                    <span className={styles.filaNombre}>{s.nombre}</span>
                    <span className={styles.filaDetalle}>
                      <span className={`${styles.filaMonto} ${styles.filaMontoCoral}`}>
                        {formatearMonto(s.monto, s.moneda)}
                        {sufijoFrecuencia(s.frecuencia)}
                      </span>
                      sigue cobrando
                    </span>
                  </span>
                  <span className={`${styles.interruptor} ${styles.interruptorEncendido}`} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Las pruebas gratis y cuándo se acaban (RN-NOT-004). */
export function TilePruebas({ suscripciones }: { suscripciones: Suscripcion[] }) {
  const pruebas = suscripciones
    .filter((s) => s.estado === 'prueba')
    .sort((a, b) => diasHasta(a.fin_prueba ?? a.fecha_proximo_cobro) - diasHasta(b.fin_prueba ?? b.fecha_proximo_cobro));

  return (
    <section className={`tile ${styles.tile} ${styles.tinteTurquesa}`} aria-label="Pruebas gratis">
      <div className={styles.cabecera}>
        <span className={styles.icono} style={{ color: 'var(--turquesa)' }}>
          <Timer size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Pruebas gratis</h2>
          <p className={styles.subtitulo}>Cuándo empiezan a cobrar</p>
        </div>
      </div>

      {pruebas.length === 0 ? (
        <p className={styles.vacio}>No tienes pruebas gratis en curso.</p>
      ) : (
        <ul className={styles.lista}>
          {pruebas.map((s) => {
            const { Icono, color } = CATEGORIA_VISUAL[s.categoria];
            const fin = s.fin_prueba ?? s.fecha_proximo_cobro;
            const dias = diasHasta(fin);
            const cobro = s.monto > 0 ? `${formatearMonto(s.monto, s.moneda)}${sufijoFrecuencia(s.frecuencia)}` : 'Gratis';
            return (
              <li key={s.id}>
                <Link to={`/suscripciones/${s.id}`} className={styles.fila} title={s.nombre}>
                  <span className={styles.filaIcono} style={{ color }}>
                    <Icono size={16} aria-hidden="true" />
                  </span>
                  <span className={styles.filaTexto}>
                    <span className={styles.filaNombre}>{s.nombre}</span>
                    <span className={styles.filaDetalle}>
                      <span className={styles.filaMonto}>{cobro}</span>
                      {dias < 0 ? `desde el ${formatearFecha(fin)}` : `${cuandoEnDias(dias).toLowerCase()}, ${formatearFecha(fin)}`}
                    </span>
                  </span>
                  <span className={`${styles.interruptor} ${styles.interruptorVerde}`} aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
