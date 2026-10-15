import type { ReactNode } from 'react';
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

/** Medidor circular completo, con lo que vaya al centro. */
export function Anillo({ porcentaje, color, tamano = 140, grosor = 11, children, etiqueta }: AnilloProps) {
  const radio = (tamano - grosor) / 2;
  const largo = 2 * Math.PI * radio;
  const lleno = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className={styles.anillo} style={{ width: tamano, height: tamano }}>
      <svg width={tamano} height={tamano} viewBox={`0 0 ${tamano} ${tamano}`} role="img" aria-label={etiqueta}>
        <circle cx={tamano / 2} cy={tamano / 2} r={radio} className={styles.pista} strokeWidth={grosor} />
        <circle
          cx={tamano / 2}
          cy={tamano / 2}
          r={radio}
          className={styles.valor}
          strokeWidth={grosor}
          stroke={color}
          strokeDasharray={largo}
          strokeDashoffset={largo * (1 - lleno / 100)}
          transform={`rotate(-90 ${tamano / 2} ${tamano / 2})`}
        />
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
  const lleno = Math.max(0, Math.min(100, porcentaje));
  return (
    <div className={styles.arco} style={{ width: ancho, height: alto }}>
      <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} role="img" aria-label={etiqueta}>
        <path d={d} className={styles.pista} strokeWidth={grosor} />
        <path
          d={d}
          className={styles.valor}
          strokeWidth={grosor}
          stroke={color}
          pathLength={100}
          strokeDasharray={100}
          strokeDashoffset={100 - lleno}
        />
      </svg>
      <div className={styles.centroArco}>{children}</div>
    </div>
  );
}
