import styles from './Avatar.module.css';

interface AvatarProps {
  /** Nombre completo: se usan las iniciales. */
  nombre: string;
  /** Color de fondo; si no se pasa, el de marca. */
  color?: string;
  tamano?: number;
  /** Cuadrado redondeado (servicios) o círculo (personas). */
  forma?: 'servicio' | 'persona';
}

export function inicialesDe(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function Avatar({ nombre, color, tamano = 40, forma = 'servicio' }: AvatarProps) {
  const texto =
    forma === 'persona' ? inicialesDe(nombre) : nombre.trim().slice(0, 1).toUpperCase() || '?';
  return (
    <span
      className={`${styles.avatar} ${forma === 'persona' ? styles.persona : ''}`}
      style={{ width: tamano, height: tamano, fontSize: Math.round(tamano * 0.4), background: color }}
      aria-hidden="true"
    >
      {texto}
    </span>
  );
}
