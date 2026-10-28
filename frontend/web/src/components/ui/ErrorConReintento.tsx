import { RefreshCw } from 'lucide-react';
import { Boton } from './Boton';
import styles from './ErrorConReintento.module.css';

interface ErrorConReintentoProps {
  mensaje: string;
  onReintentar: () => void;
}

/**
 * Una carga que falló: dice qué pasó (role="alert", se anuncia) y ofrece
 * volver a intentar. La usan Cuentas conectadas y Calendario.
 */
export function ErrorConReintento({ mensaje, onReintentar }: ErrorConReintentoProps) {
  return (
    <div className={styles.caja}>
      <p role="alert">{mensaje}</p>
      <Boton variante="secundario" tamano="s" icono={<RefreshCw size={15} aria-hidden="true" />} onClick={onReintentar}>
        Reintentar
      </Boton>
    </div>
  );
}
