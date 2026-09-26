import { conteoPorEstado, gastoProyectado, getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { useEffect, useState } from 'react';
import { AppLayout } from '../components/layout/AppLayout';
import { FantasmaHighlight } from '../components/Dashboard/FantasmaHighlight';
import { GastoPorCategoriaChart } from '../components/Dashboard/GastoPorCategoriaChart';
import { ProximosCobrosWidget } from '../components/Dashboard/ProximosCobrosWidget';
import { SummaryCards } from '../components/Dashboard/SummaryCards';
import { diasHasta } from '../utils/fechas';
import { descargarSuscripcionesCsv } from '../utils/exportarCsv';
import styles from './DashboardPage.module.css';

type EstadoCarga =
  | { tipo: 'cargando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'listo'; suscripciones: Suscripcion[] };

export function DashboardPage() {
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

  const botonExportar =
    estado.tipo === 'listo' ? (
      <button
        type="button"
        className={styles.botonExportar}
        onClick={() => descargarSuscripcionesCsv(estado.suscripciones)}
      >
        ⭳ Exportar CSV
      </button>
    ) : undefined;

  return (
    <AppLayout headerTitulo="Inicio" headerSubtitulo="Bienvenido."
      headerTitulo="Panel"
      headerSubtitulo="Resumen de tu gasto en suscripciones."
      headerEtiquetaFecha="Octubre, 2026"
      headerAccionDerecha={botonExportar}
    >
      {estado.tipo === 'cargando' && <p className={styles.mensaje}>Cargando tu panel…</p>}
      {estado.tipo === 'error' && <p className={styles.mensaje}>{estado.mensaje}</p>}
      {estado.tipo === 'listo' && (
        <>
          <FantasmaHighlight suscripciones={estado.suscripciones} />

          <SummaryCards
            gastoProyectadoMes={gastoProyectado(estado.suscripciones)}
            totalProximos7Dias={calcularTotalProximos7Dias(estado.suscripciones)}
            cantidadProximos7Dias={calcularCantidadProximos7Dias(estado.suscripciones)}
            cantidadFantasma={conteoPorEstado(estado.suscripciones).fantasma}
          />

          <div className={styles.paneles}>
            <GastoPorCategoriaChart suscripciones={estado.suscripciones} />
            <ProximosCobrosWidget suscripciones={estado.suscripciones} />
          </div>
        </>
      )}
    </AppLayout>
  );
}

function proximosDentroDe7Dias(suscripciones: Suscripcion[]): Suscripcion[] {
  return suscripciones.filter(
    (s) => s.estado === 'activo' && diasHasta(s.fecha_proximo_cobro) >= 0 && diasHasta(s.fecha_proximo_cobro) <= 7,
  );
}

function calcularTotalProximos7Dias(suscripciones: Suscripcion[]): number {
  return proximosDentroDe7Dias(suscripciones).reduce((total, s) => total + s.monto, 0);
}

function calcularCantidadProximos7Dias(suscripciones: Suscripcion[]): number {
  return proximosDentroDe7Dias(suscripciones).length;
}
