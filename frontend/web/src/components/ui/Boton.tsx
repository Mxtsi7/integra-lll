import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Spinner } from '../Spinner';
import styles from './Boton.module.css';

type Variante = 'primario' | 'secundario' | 'sutil' | 'peligro';
type Tamano = 'm' | 's';

interface BotonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: Variante;
  tamano?: Tamano;
  /** Muestra un spinner y deshabilita el botón. El texto sigue siendo el de children. */
  cargando?: boolean;
  icono?: ReactNode;
  ancho?: boolean;
}

const CLASE_VARIANTE: Record<Variante, string> = {
  primario: styles.primario,
  secundario: styles.secundario,
  sutil: styles.sutil,
  peligro: styles.peligro,
};

function clasesDe(variante: Variante, tamano: Tamano, ancho: boolean, extra: string) {
  return [
    styles.boton,
    CLASE_VARIANTE[variante],
    tamano === 's' ? styles.chico : '',
    ancho ? styles.ancho : '',
    extra,
  ].join(' ');
}

export function Boton({
  variante = 'primario',
  tamano = 'm',
  cargando = false,
  icono,
  ancho = false,
  className = '',
  children,
  disabled,
  type = 'button',
  ...resto
}: BotonProps) {
  return (
    <button
      type={type}
      className={clasesDe(variante, tamano, ancho, className)}
      disabled={disabled || cargando}
      {...resto}
    >
      {cargando ? <Spinner size={14} decorativo /> : icono}
      {children}
    </button>
  );
}

interface BotonEnlaceProps {
  to: string;
  variante?: Variante;
  tamano?: Tamano;
  icono?: ReactNode;
  ancho?: boolean;
  className?: string;
  children: ReactNode;
}

/** Un enlace con la forma del botón, para navegar sin fingir una acción. */
export function BotonEnlace({
  to,
  variante = 'primario',
  tamano = 'm',
  icono,
  ancho = false,
  className = '',
  children,
}: BotonEnlaceProps) {
  return (
    <Link to={to} className={clasesDe(variante, tamano, ancho, className)}>
      {icono}
      {children}
    </Link>
  );
}
