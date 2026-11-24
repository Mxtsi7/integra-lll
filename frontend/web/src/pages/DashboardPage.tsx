import { getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { SeccionPresupuesto } from '../components/presupuesto/SeccionPresupuesto';
import { TileCategorias } from '../components/Dashboard/TileCategorias';
import { TileHub } from '../components/Dashboard/TileHub';
import { TileFantasmas, TilePruebas } from '../components/Dashboard/TileListas';
import { TileProximo } from '../components/Dashboard/TileProximo';
import { gastoDelMesDe, TileResumen } from '../components/Dashboard/TileResumen';
import { TileSalud } from '../components/Dashboard/TileSalud';
import { GraficoDeGastos } from '../components/Informes/GraficoDeGastos';
import { sinGastos } from '../components/Informes/periodosDeInforme';
import { useAuth } from '../context/AuthContext';
import { useCatalogos } from '../context/CatalogosContext';
import { useInformeMensual } from '../hooks/useInformeMensual';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { descargarSuscripcionesCsv } from '../utils/exportarCsv';
import { fechaATexto } from '../utils/calendario';
import styles from './DashboardPage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; suscripciones: Suscripcion[] };

export function DashboardPage() {
  const { datos: catalogos } = useCatalogos();
  const { usuario } = useAuth();
  const [estado, setEstado] = useState<EstadoCarga>({ tipo: 'cargando' });
  // La moneda vive en la URL (?moneda=), como el mes del presupuesto (?mes=): al recargar se queda en la misma.
  const [parametros, setParametros] = useSearchParams();
  const monedaElegida = parametros.get('moneda') ?? '';
  const elegirMoneda = (codigo: string) =>
    setParametros((actuales) => {
      const siguientes = new URLSearchParams(actuales);
      siguientes.set('moneda', codigo);
      return siguientes;
    });

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
  // Las monedas presentes incluyen históricos inactivos, aun si falla el catálogo.
  const todas = estado.tipo === 'listo' ? estado.suscripciones : [];
  const monedas = [...new Set(todas.map((s) => s.moneda))].sort();
  const moneda = monedas.includes(monedaElegida) ? monedaElegida
    : monedas.includes('CLP') ? 'CLP' : monedas[0] ?? catalogos?.predeterminados.moneda ?? 'CLP';
  const delPanel = todas.filter((s) => s.moneda === moneda);
  // El mes lo elige el presupuesto del Panel (?mes=): las cifras y el presupuesto miran el mismo mes.
  const { mes } = useMesEnUrl(fechaATexto(new Date()));
  const { carga: informe } = useInformeMensual(mes, moneda);
  // El último mes del informe es el elegido. Mientras no llega, no hay cifra que mostrar.
  const gastoDelMes = informe.tipo === 'listo' ? gastoDelMesDe(informe.meses[informe.meses.length - 1]) : null;

  return (
    <AppLayout
      headerTitulo="Panel"
      headerSubtitulo="Cuánto gastas, en qué, y qué viene."
    >
      {estado.tipo === 'cargando' && <EsqueletoPanel />}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'listo' && (
        <>
        <div className={styles.moneda}>
          <label htmlFor="moneda-panel">Moneda del panel</label>
          <select id="moneda-panel" value={moneda} disabled={monedas.length === 0}
            onChange={(e) => elegirMoneda(e.target.value)}>
            {(monedas.length ? monedas : [moneda]).map((codigo) => (
              <option key={codigo} value={codigo}>{codigo} — {catalogos?.monedas.find((m) => m.codigo === codigo)?.nombre ?? codigo}</option>
            ))}
          </select>
          <span>Cifras, gráficos y exportación en {moneda}.</span>
        </div>
        <div className={styles.grilla} key={moneda}>
          <div className={styles.columnaIzquierda}>
            <TileResumen suscripciones={delPanel} moneda={moneda} nombreHogar={nombreHogar} gastoDelMes={gastoDelMes} />
            {/* Los mismos meses que la cifra del mes: salen de la misma respuesta (S3-CH-12). */}
            {informe.tipo === 'listo' && !sinGastos(informe.meses) && (
              <GraficoDeGastos meses={informe.meses} mesElegido={mes} />
            )}
            <SeccionPresupuesto moneda={moneda} />
            <TileSalud suscripciones={delPanel} moneda={moneda} />
            <TileProximo suscripciones={delPanel} />
          </div>

          <div className={styles.columnaDerecha}>
            <TileHub
              suscripciones={delPanel} moneda={moneda}
              alExportar={() => descargarSuscripcionesCsv(delPanel, `suscripciones-${moneda}.csv`, catalogos ?? undefined)}
            />
            <div className={styles.filaInferior}>
              <TileFantasmas suscripciones={delPanel} />
              <TilePruebas suscripciones={delPanel} />
              <TileCategorias suscripciones={delPanel} moneda={moneda} />
            </div>
          </div>
        </div>
        </>
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
