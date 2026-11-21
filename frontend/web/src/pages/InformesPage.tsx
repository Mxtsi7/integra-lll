import { desplazarMes, etiquetaDelPeriodo, getResumenDelPeriodo, type ResumenDelPeriodo as Resumen } from '@ojoalgasto/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { InformeDelPeriodo } from '../components/Informes/InformeDelPeriodo';
import { ResumenDelPeriodo } from '../components/Informes/ResumenDelPeriodo';
import styles from '../components/Informes/Informes.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { Boton } from '../components/ui/Boton';
import { CampoSelect } from '../components/ui/Campo';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Seccion } from '../components/ui/Seccion';
import { useCatalogos } from '../context/CatalogosContext';
import { useInformeMensual } from '../hooks/useInformeMensual';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { useMonedaEnUrl } from '../hooks/useMonedaEnUrl';
import { useResumenPeriodo } from '../hooks/useResumenPeriodo';
import { fechaATexto, mesDeFecha } from '../utils/calendario';

export interface InformesPageProps {
  /** Solo en pruebas. Debe ser una función estable: si cambia, el resumen se vuelve a pedir. */
  cargarResumen?: (mes: string) => Promise<Resumen>;
}

/**
 * Informes por periodo, en una sola página:
 * - Arriba, el gasto del mes en cada moneda, con la cantidad por estado y el texto del resumen (AN-22).
 * - Abajo, una moneda a la vez: el histórico de seis meses y la descarga de los cobros del mes (S3-CH-25).
 *
 * El mes vive en la URL (?mes=YYYY-MM) y la moneda también (?moneda=CLP). No se avanza más allá del mes
 * actual. Todo sale de GET /api/suscripciones/resumen/ (VI-06) y GET /api/suscripciones/exportar-csv/ (VI-25);
 * no hay datos en el código, y las monedas nunca se mezclan.
 */
export function InformesPage({ cargarResumen = getResumenDelPeriodo }: InformesPageProps) {
  // "Hoy" se fija al abrir la página.
  const [hoy] = useState(() => fechaATexto(new Date()));
  const mesActual = mesDeFecha(hoy);
  const { mes, irAMes } = useMesEnUrl(hoy);
  const { estado, reintentar } = useResumenPeriodo(mes, cargarResumen);
  const catalogos = useCatalogos();
  const monedas = (catalogos.datos?.monedas ?? []).filter((opcion) => opcion.activo).sort((a, b) => a.orden - b.orden);
  const { moneda, irAMoneda } = useMonedaEnUrl(
    monedas.map((opcion) => opcion.codigo),
    catalogos.datos?.predeterminados.moneda ?? null,
  );

  return (
    <AppLayout headerTitulo="Informes" headerSubtitulo="Cuánto gastas y cuánto te falta por pagar, mes a mes.">
      <div className={styles.grid}>
        <Seccion titulo="Periodo">
          <div className={styles.navegacion}>
            <Boton
              variante="secundario"
              tamano="s"
              icono={<ChevronLeft size={16} aria-hidden="true" />}
              onClick={() => irAMes(desplazarMes(mes, -1))}
            >
              Mes anterior
            </Boton>
            <h2 className={styles.periodo} aria-live="polite">
              {etiquetaDelPeriodo(mes)}
            </h2>
            <Boton variante="secundario" tamano="s" disabled={mes === mesActual} onClick={() => irAMes(mesActual)}>
              Este mes
            </Boton>
            <Boton
              variante="secundario"
              tamano="s"
              icono={<ChevronRight size={16} aria-hidden="true" />}
              disabled={mes >= mesActual}
              onClick={() => irAMes(desplazarMes(mes, 1))}
            >
              Mes siguiente
            </Boton>
          </div>
        </Seccion>

        {estado.tipo === 'cargando' && (
          <div className={styles.mensaje}>
            <Spinner size={22} etiqueta="Cargando el resumen del periodo" />
          </div>
        )}
        {estado.tipo === 'error' && <ErrorConReintento mensaje={estado.mensaje} onReintentar={reintentar} />}
        {estado.tipo === 'listo' && <ResumenDelPeriodo resumen={estado.resumen} />}

        <Seccion titulo="Histórico y descarga de cobros" tinte="azul">
          {catalogos.datos === null && catalogos.cargando && (
            <div className={styles.estadoCarga}>
              <Spinner size={18} etiqueta="Cargando las monedas" />
            </div>
          )}
          {catalogos.datos === null && catalogos.error !== null && (
            <ErrorConReintento mensaje={catalogos.error} onReintentar={catalogos.recargar} />
          )}
          {catalogos.datos !== null && moneda === null && (
            <p className={styles.vacio}>No hay monedas disponibles para mostrar informes.</p>
          )}
          {moneda !== null && (
            <>
              <CampoSelect
                etiqueta="Moneda"
                className={styles.moneda}
                value={moneda}
                onChange={(evento) => irAMoneda(evento.target.value)}
              >
                {monedas.map((opcion) => (
                  <option key={opcion.codigo} value={opcion.codigo}>
                    {opcion.codigo} · {opcion.nombre}
                  </option>
                ))}
              </CampoSelect>
              <InformeDeLaMoneda mes={mes} moneda={moneda} />
            </>
          )}
        </Seccion>
      </div>
    </AppLayout>
  );
}

/** Pide el histórico de la moneda elegida. Es aparte para que el hook solo corra con una moneda. */
function InformeDeLaMoneda({ mes, moneda }: { mes: string; moneda: string }) {
  const { carga, reintentar } = useInformeMensual(mes, moneda);
  return <InformeDelPeriodo carga={carga} mes={mes} moneda={moneda} onReintentar={reintentar} />;
}
