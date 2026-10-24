import { getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { TileCategorias } from '../components/Dashboard/TileCategorias';
import { TileHub } from '../components/Dashboard/TileHub';
import { TileFantasmas, TilePruebas } from '../components/Dashboard/TileListas';
import { TileProximo } from '../components/Dashboard/TileProximo';
import { TileResumen } from '../components/Dashboard/TileResumen';
import { TileSalud } from '../components/Dashboard/TileSalud';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { diasHasta } from '../utils/fechas';
import { descargarSuscripcionesCsv } from '../utils/exportarCsv';
import styles from './DashboardPage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; suscripciones: Suscripcion[] };

/** Cuántas cosas piden atención: cobros de la semana y suscripciones sin uso. */
export function contarAvisos(suscripciones: Suscripcion[]): number {
  return suscripciones.filter(
    (s) =>
      s.estado === 'fantasma' ||
      (s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0 && diasHasta(s.fecha_proximo_cobro) <= 7),
  ).length;
}

export function DashboardPage() {
  const { datos: catalogos } = useCatalogos();
  const { usuario } = useAuth();
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });

  useEffect(() => {
    let cancelado = false;

    getSuscripciones()
      .then((suscripciones) => {
        if (!cancelado) setEstado({ tipo: 'listo', suscripciones });
      })
      .catch(() => {
        if (!cancelado) {
          setEstado({
            tipo: 'error',
            mensaje: 'No pudimos cargar tu panel. Intenta de nuevo en unos segundos.',
          });
        }
      });

    return () => {
      cancelado = true;
    };
  }, []);

  const nombreHogar = usuario ? `Hogar de ${usuario.nombre}` : 'Tu hogar';

  return (
    <AppLayout
      headerTitulo="Panel"
      headerSubtitulo="Cuánto gastas, en qué, y qué viene."
      avisos={estado.tipo === 'listo' ? contarAvisos(estado.suscripciones) : undefined}
    >
      {estado.tipo === 'cargando' && <EsqueletoPanel />}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'listo' && (
        <div className={styles.grilla}>
          <div className={styles.columnaIzquierda}>
            <TileResumen suscripciones={estado.suscripciones} nombreHogar={nombreHogar} />
            <TileSalud suscripciones={estado.suscripciones} />
            <TileProximo suscripciones={estado.suscripciones} />
          </div>

          <div className={styles.columnaDerecha}>
            <TileHub
              suscripciones={estado.suscripciones}
              alExportar={() => descargarSuscripcionesCsv(estado.suscripciones, 'suscripciones.csv', catalogos ?? undefined)}
            />
            <div className={styles.filaInferior}>
              <TileFantasmas suscripciones={estado.suscripciones} />
              <TilePruebas suscripciones={estado.suscripciones} />
              <TileCategorias suscripciones={estado.suscripciones} />
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function EsqueletoPanel() {
  return (
    <div className={styles.grilla} aria-busy="true" aria-label="Cargando tu panel">
      <div className={styles.columnaIzquierda}>
        <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
        <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
        <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
      </div>
      <div className={styles.columnaDerecha}>
        <div className={`${styles.esqueleto} ${styles.esqueletoGrande}`} />
        <div className={styles.filaInferior}>
          <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
          <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
          <div className={`${styles.esqueleto} ${styles.esqueletoChico}`} />
        </div>
      </div>
    </div>
  );
}
