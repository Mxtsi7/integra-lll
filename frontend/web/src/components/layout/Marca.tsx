import { useId } from 'react';
import { Link } from 'react-router-dom';
import styles from './Marca.module.css';

/**
 * El ojo: un iris con una moneda de pupila, sobre un cuadrado naranjo.
 * Es la única ilustración de la marca; va chico en la barra y grande en
 * el acceso.
 */
export function OjoMarca({ tamano = 40 }: { tamano?: number }) {
  // El ojo aparece varias veces en la página (barra, menú, estados vacíos): con
  // un id fijo los degradados se repetían y, si el primero quedaba oculto, los
  // demás perdían el color (CH-25). Sin ":" para que url(#…) no tenga dudas.
  const idFondo = `ojo-fondo-${useId().replace(/:/g, '')}`;
  return (
    <svg width={tamano} height={tamano} viewBox="0 0 40 40" aria-hidden="true" className={styles.ojo}>
      <defs>
        <linearGradient id={idFondo} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffa05c" />
          <stop offset="1" stopColor="#ff7a2f" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="12" fill={`url(#${idFondo})`} />
      <path
        d="M7 20c3.3-5.6 7.6-8.5 13-8.5s9.7 2.9 13 8.5c-3.3 5.6-7.6 8.5-13 8.5S10.3 25.6 7 20Z"
        fill="none"
        stroke="#1a0d05"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="20" r="4.6" fill="#1a0d05" />
      <circle cx="21.6" cy="18.4" r="1.4" fill="#ffd9bf" />
    </svg>
  );
}

export function Marca({
  a = '/home',
  tamano = 'm',
  conTexto = true,
}: {
  a?: string;
  tamano?: 'm' | 'l';
  conTexto?: boolean;
}) {
  return (
    <Link to={a} className={`${styles.marca} ${tamano === 'l' ? styles.grande : ''}`} aria-label="Ojo al Gasto">
      <OjoMarca tamano={tamano === 'l' ? 56 : 40} />
      {conTexto && (
        <span className={styles.texto}>
          <span className={styles.nombre}>Ojo al Gasto</span>
          <span className={styles.lema}>Tus suscripciones, a la vista</span>
        </span>
      )}
    </Link>
  );
}
