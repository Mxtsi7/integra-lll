import type { CSSProperties, ReactNode } from 'react';
import styles from './Medidores.module.css';

interface AnilloProps {
  /** 0 a 100. */
  porcentaje: number;
  color: string;
  tamano?: number;
  grosor?: number;
  children?: ReactNode;
  etiqueta: string;
}

/** 0 a 100, aunque llegue fuera de rango o NaN. */
function normalizar(porcentaje: number): number {
  return Number.isFinite(porcentaje) ? Math.max(0, Math.min(100, porcentaje)) : 0;
}

/**
 * El trazo del valor. `color` va también como `color` del elemento: el
 * brillo (drop-shadow con currentColor) toma el color del trazo y no el del
 * texto, que lo dejaba blanco. En 0 % no se dibuja: con la punta redonda
 * quedaba un punto suelto. `--inicio` es el largo vacío, para que la
 * animación se llene desde cero en vez de dar vueltas.
 */
function estiloDelValor(color: string, vacio: number): CSSProperties {
  return { color, '--inicio': vacio } as CSSProperties;
}

/** Medidor circular completo, con lo que vaya al centro. */
export function Anillo({ porcentaje, color, tamano = 140, grosor = 11, children, etiqueta }: AnilloProps) {
  const radio = (tamano - grosor) / 2;
  const largo = 2 * Math.PI * radio;
  const lleno = normalizar(porcentaje);
  return (
    <div className={styles.anillo} style={{ width: tamano, height: tamano }}>
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} role="img" aria-label={etiqueta}>
        <circle cx={tamano / 2} cy={tamano / 2} r={radio} className={styles.pista} strokeWidth={grosor} />
        {lleno > 0 && (
          <circle
            cx={tamano / 2}
            cy={tamano / 2}
            r={radio}
            className={styles.valor}
            style={estiloDelValor(color, largo)}
            strokeWidth={grosor}
            stroke="currentColor"
            strokeDasharray={largo}
            strokeDashoffset={largo * (1 - lleno / 100)}
            transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`}
          />
        )}
      </svg>
      <div className={styles.centro}>{children}</div>
    </div>
  );
}

interface ArcoProps {
  /** 0 a 100. */
  porcentaje: number;
  color: string;
  ancho?: number;
  grosor?: number;
  children?: ReactNode;
  etiqueta: string;
}

/** Medio círculo, como un velocímetro. */
export function Arco({ porcentaje, color, ancho = 200, grosor = 14, children, etiqueta }: ArcoProps) {
  const radio = (ancho - grosor) / 2;
  const alto = radio + grosor;
  const cx = ancho / 2;
  const cy = radio + grosor / 2;
  const d = `M ${cx - radio} ${cy} A ${radio} ${radio} 0 0 1 ${cx + radio} ${cy}`;
  const lleno = normalizar(porcentaje);
  return (
    <div className={styles.arco} style={{ width: ancho, height: alto }}>
      <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}>
        <path d={d} className={styles.pista} strokeWidth={grosor} />
        {lleno > 0 && (
          <path
            d={d}
            className={styles.valor}
            style={estiloDelValor(color, 100)}
            strokeWidth={grosor}
            stroke="currentColor"
            pathLength={100}
            strokeDasharray={100}
            strokeDashoffset={100 - lleno}
          />
        )}
      </svg>
      <div className={styles.centroArco}>{children}</div>
    </div>
  );
}
