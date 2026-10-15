import { formatearFecha, formatearMonto, type Suscripcion } from '@ojoalgasto/shared';
import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { diasHasta } from '../../utils/fechas';
import { cuandoEnDias } from '../subscriptions/presentacion';
import { Arco } from './Medidores';
import styles from './Tiles.module.css';

interface TileProximoProps {
  suscripciones: Suscripcion[];
}

const VENTANA_DIAS = 30;

/**
 * El cobro que viene, como el medidor de temperatura: un arco que se va
 * llenando a medida que se acerca el día, y flechas para recorrer los
 * siguientes.
 */
export function TileProximo({ suscripciones }: TileProximoProps) {
  const proximos = suscripciones
    .filter((s) => s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0)
    .sort((a, b) => diasHasta(a.fecha_proximo_cobro) - diasHasta(b.fecha_proximo_cobro));
  const [indice, setIndice] = useState(0);
  const actual = proximos[Math.min(indice, proximos.length - 1)];

  if (!actual) {
    return (
      <section className={`tile ${styles.tile} ${styles.tinteAcento}`} aria-label="Próximo cobro">
        <div className={styles.cabecera}>
          <span className={styles.icono} style={{ color: 'var(--acento)' }}>
            <CalendarClock size={19} aria-hidden="true" />
          </span>
          <div className={styles.titulos}>
            <h2 className={styles.titulo}>Próximo cobro</h2>
          </div>
        </div>
        <p className={styles.vacio}>No hay cobros programados.</p>
      </section>
    );
  }

  const dias = diasHasta(actual.fecha_proximo_cobro);
  // Mientras más cerca el cobro, más lleno el arco.
  const porcentaje = Math.round(((VENTANA_DIAS - Math.min(dias, VENTANA_DIAS)) / VENTANA_DIAS) * 100);
  const enSemana = proximos.filter((s) => diasHasta(s.fecha_proximo_cobro) <= 7).length;

  return (
    <section className={`tile ${styles.tile} ${styles.tinteAcento}`} aria-label="Próximo cobro">
      <div className={styles.cabecera}>
        <span className={styles.icono} style={{ color: 'var(--acento)' }}>
          <CalendarClock size={19} aria-hidden="true" />
        </span>
        <div className={styles.titulos}>
          <h2 className={styles.titulo}>Próximo cobro</h2>
          <p className={styles.subtitulo}>
            {enSemana === 0 ? 'Nada esta semana' : enSemana === 1 ? '1 cobro esta semana' : `${enSemana} cobros esta semana`}
          </p>
        </div>
      </div>

      <div className={styles.proximoCuerpo}>
        <Arco porcentaje={porcentaje} color="var(--acento)" ancho={210} etiqueta={`Faltan ${dias} días para el cobro`}>
          <span className={styles.proximoCuando}>{cuandoEnDias(dias)}</span>
          <span className={styles.proximoFecha}>{formatearFecha(actual.fecha_proximo_cobro)}</span>
        </Arco>

        <div className={styles.proximoServicio}>
          <button
            type="button"
            className={styles.proximoNav}
            onClick={() => setIndice((i) => Math.max(0, i - 1))}
            disabled={indice === 0}
            aria-label="Cobro anterior"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <Link to={`/suscripciones/${actual.id}`} className={styles.proximoServicioTexto}>
            <p className={styles.proximoNombre}>{actual.nombre}</p>
            <p className={styles.proximoMonto}>{formatearMonto(actual.monto, actual.moneda)}</p>
          </Link>
          <button
            type="button"
            className={styles.proximoNav}
            onClick={() => setIndice((i) => Math.min(proximos.length - 1, i + 1))}
            disabled={indice >= proximos.length - 1}
            aria-label="Cobro siguiente"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.proximoPosicion}>
          {indice + 1} de {proximos.length}
        </p>
      </div>
    </section>
  );
}
