import { conMayuscula, type OpcionCatalogo } from '@ojoalgasto/shared';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { sumarMeses } from '../../utils/calendario';
import { Boton } from '../ui/Boton';
import { CampoSelect } from '../ui/Campo';
import styles from './Informes.module.css';
import { nombreDelMes } from './periodosDeInforme';

interface SelectorDePeriodoProps {
  /** El mes que se mira, "YYYY-MM". */
  mes: string;
  moneda: string;
  /** Las monedas entre las que se puede elegir. */
  monedas: readonly OpcionCatalogo[];
  onIrAMes: (mes: string) => void;
  onMesActual: () => void;
  onCambiarMoneda: (moneda: string) => void;
}

/**
 * S3-CH-25: el mes y la moneda de todo el informe. El título del mes se anuncia al cambiar
 * (aria-live), y las flechas dicen a qué mes llevan.
 */
export function SelectorDePeriodo({ mes, moneda, monedas, onIrAMes, onMesActual, onCambiarMoneda }: SelectorDePeriodoProps) {
  const anterior = sumarMeses(mes, -1);
  const siguiente = sumarMeses(mes, 1);

  return (
    <div className={styles.selector}>
      <h2 className={styles.tituloPeriodo} aria-live="polite">
        {conMayuscula(nombreDelMes(mes))}
      </h2>
      <div className={styles.controles}>
        <div className={styles.grupoMes} role="group" aria-label="Cambiar de mes">
          <button
            type="button"
            className={styles.flecha}
            aria-label={`Mes anterior: ${nombreDelMes(anterior)}`}
            onClick={() => onIrAMes(anterior)}
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <Boton variante="secundario" tamano="s" onClick={onMesActual}>
            Mes actual
          </Boton>
          <button
            type="button"
            className={styles.flecha}
            aria-label={`Mes siguiente: ${nombreDelMes(siguiente)}`}
            onClick={() => onIrAMes(siguiente)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <CampoSelect
          etiqueta="Moneda"
          className={styles.moneda}
          value={moneda}
          onChange={(evento) => onCambiarMoneda(evento.target.value)}
        >
          {monedas.map((opcion) => (
            <option key={opcion.codigo} value={opcion.codigo}>
              {opcion.codigo} · {opcion.nombre}
            </option>
          ))}
        </CampoSelect>
      </div>
    </div>
  );
}
