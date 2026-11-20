import { desplazarMes, etiquetaDelPeriodo, getResumenDelPeriodo, type ResumenDelPeriodo as Resumen } from '@ojoalgasto/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { ResumenDelPeriodo } from '../components/Informes/ResumenDelPeriodo';
import styles from '../components/Informes/Informes.module.css';
import { AppLayout } from '../components/layout/AppLayout';
import { Spinner } from '../components/Spinner';
import { Boton } from '../components/ui/Boton';
import { ErrorConReintento } from '../components/ui/ErrorConReintento';
import { Seccion } from '../components/ui/Seccion';
import { useMesEnUrl } from '../hooks/useMesEnUrl';
import { useResumenPeriodo } from '../hooks/useResumenPeriodo';
import { fechaATexto, mesDeFecha } from '../utils/calendario';

export interface InformesPageProps {
  /** Solo en pruebas. Debe ser una función estable: si cambia, el resumen se vuelve a pedir. */
  cargarResumen?: (mes: string) => Promise<Resumen>;
}

/**
 * Informes por periodo (AN-22): el gasto de un mes, lo que falta por cobrar y la cantidad de
 * suscripciones por estado, todo de GET /api/suscripciones/resumen/ (VI-06). Misma llamada y mismo
 * texto que el Informe móvil (AN-23), porque salen de `shared`.
 *
 * El mes vive en la URL (?mes=YYYY-MM): Atrás/Adelante del navegador recorren los meses vistos y al
 * recargar se queda en el mismo. No se avanza más allá del mes actual.
 */
export function InformesPage({ cargarResumen = getResumenDelPeriodo }: InformesPageProps) {
  // "Hoy" se fija al abrir la página.
  const [hoy] = useState(() => fechaATexto(new Date()));
  const mesActual = mesDeFecha(hoy);
  const { mes, irAMes } = useMesEnUrl(hoy);
  const { estado, reintentar } = useResumenPeriodo(mes, cargarResumen);

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
      </div>
    </AppLayout>
  );
}
