import { conMayuscula, formatearMesAnio } from '@ojoalgasto/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { partesDeMes, sumarMeses } from '../../utils/calendario';
import { Boton } from '../ui/Boton';
import { RUTA_AGENDA, RUTA_CALENDARIO, rutaConMes } from './rutas';
import styles from './Calendario.module.css';

const nombreMes = (mes: string) => {
  const { anio, mes: indice } = partesDeMes(mes);
  return formatearMesAnio(anio, indice);
};

interface NavegacionMesProps {
  /** Mes que se está mirando, "YYYY-MM". */
  mes: string;
  vista: 'mes' | 'agenda';
  onIrAMes: (mes: string) => void;
  /** Volver al mes y al día de hoy. */
  onHoy: () => void;
}

/**
 * Título del mes, anterior / Hoy / siguiente y el cambio entre la vista Mes
 * y la Agenda (CH-19, CH-21). El título se anuncia al cambiar (aria-live),
 * y los botones de flecha dicen a qué mes llevan.
 */
export function NavegacionMes({ mes, vista, onIrAMes, onHoy }: NavegacionMesProps) {
  const anterior = sumarMeses(mes, -1);
  const siguiente = sumarMeses(mes, 1);

  return (
    <div className={styles.barra}>
      <h2 className={styles.tituloMes} aria-live="polite">
        {conMayuscula(nombreMes(mes))}
      </h2>
      <div className={styles.controles}>
        <div className={styles.grupoMes} role="group" aria-label="Cambiar de mes">
          <button
            type="button"
            className={styles.flecha}
            aria-label={`Mes anterior: ${nombreMes(anterior)}`}
            onClick={() => onIrAMes(anterior)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <Boton variante="secundario" tamano="s" onClick={onHoy}>
            Hoy
          </Boton>
          <button
            type="button"
            className={styles.flecha}
            aria-label={`Mes siguiente: ${nombreMes(siguiente)}`}
            onClick={() => onIrAMes(siguiente)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <nav className={styles.vistas} aria-label="Vista del calendario">
          <Link
            to={rutaConMes(RUTA_CALENDARIO, mes)}
            className={styles.vista}
            aria-current={vista === 'mes' ? 'page' : undefined}
          >
            Mes
          </Link>
          <Link
            to={rutaConMes(RUTA_AGENDA, mes)}
            className={styles.vista}
            aria-current={vista === 'agenda' ? 'page' : undefined}
          >
            Agenda
          </Link>
        </nav>
      </div>
    </div>
  );
}
