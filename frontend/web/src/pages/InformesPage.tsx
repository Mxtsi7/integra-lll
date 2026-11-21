import { useState } from 'react';
import { InformeDelPeriodo } from '../components/Informes/InformeDelPeriodo';
import styles from '../components/Informes/Informes.module.css';
import { SelectorDePeriodo } from '../components/Informes/SelectorDePeriodo';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { useCatalogos } from '../context/CatalogosContext';
import { useInformeMensual } from '../hooks/useInformeMensual';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { useMonedaEnUrl } from '../hooks/useMonedaEnUrl';
import { fechaATexto, mesDeFecha } from '../utils/calendario';

/**
 * Informes (S3-CH-25): el gasto de un mes en una moneda, con los meses anteriores y la descarga
 * de sus cobros. El mes y la moneda viven en la URL (?mes=YYYY-MM&moneda=CLP). Todo sale de
 * GET /api/suscripciones/resumen/ (VI-06) y de GET /api/suscripciones/exportar-csv/ (VI-25); no
 * hay datos en el código, y las monedas nunca se mezclan.
 */
export function InformesPage() {
  // "Hoy" se fija al abrir la página.
  const [hoy] = useState(() => fechaATexto(new Date()));
  const { mes, irAMes } = useMesEnUrl(hoy);
  const catalogos = useCatalogos();
  const monedas = (catalogos.datos?.monedas ?? []).filter((opcion) => opcion.activo).sort((a, b) => a.orden - b.orden);
  const { moneda, irAMoneda } = useMonedaEnUrl(
    monedas.map((opcion) => opcion.codigo),
    catalogos.datos?.predeterminados.moneda ?? null,
  );

  return (
    <AppLayout headerTitulo="Informes" headerSubtitulo="Cuánto gastas cada mes, en cada moneda.">
      {catalogos.datos === null && catalogos.cargando && (
        <div className={styles.estadoCarga}>
          <Spinner size={18} etiqueta="Cargando las monedas" />
        </div>
      )}
      {catalogos.datos === null && catalogos.error !== null && (
        <ErrorConReintento mensaje={catalogos.error} onReintentar={catalogos.recargar} />
      )}
      {catalogos.datos !== null && moneda === null && <p className={styles.vacio}>No hay monedas disponibles para mostrar informes.</p>}
      {moneda !== null && (
        <div className={styles.informe}>
          <SelectorDePeriodo
            mes={mes}
            moneda={moneda}
            monedas={monedas}
            onIrAMes={irAMes}
            onMesActual={() => irAMes(mesDeFecha(hoy))}
            onCambiarMoneda={irAMoneda}
          />
          <InformeDeLaMoneda mes={mes} moneda={moneda} />
        </div>
      )}
    </AppLayout>
  );
}

/** Pide el informe del mes y la moneda elegidos. Es aparte para que el hook solo corra con una moneda. */
function InformeDeLaMoneda({ mes, moneda }: { mes: string; moneda: string }) {
  const { carga, reintentar } = useInformeMensual(mes, moneda);
  return <InformeDelPeriodo carga={carga} mes={mes} moneda={moneda} onReintentar={reintentar} />;
}
