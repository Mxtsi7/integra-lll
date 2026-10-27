import { useEffect, useRef } from "react";
import { Boton } from "../ui/Boton";
import styles from "./SusForm.module.css";

interface AvisoCambiosSinGuardarProps {
  /** Vuelve al formulario sin tocar nada. */
  onSeguirEditando: () => void;
  /** Cierra el formulario (y sigue la navegación pendiente, si la hay); se pierden los cambios. */
  onDescartar: () => void;
}

/**
 * Aviso de cambios sin guardar (CH-16). Se muestra DENTRO del modal del
 * formulario (no como un segundo modal encima): así Escape y el foco siguen
 * siendo los de un solo diálogo, y el formulario queda montado detrás con
 * todo lo que se escribió.
 *
 * Al aparecer, el foco va a "Seguir editando" (la opción que no pierde
 * nada). Al elegirla, el foco vuelve a donde estaba antes del aviso.
 */
export function AvisoCambiosSinGuardar({ onSeguirEditando, onDescartar }: AvisoCambiosSinGuardarProps) {
  const contenedor = useRef<HTMLDivElement>(null);
  const focoAnterior = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Solo la primera vez: en desarrollo (StrictMode) React corre este
    // efecto dos veces, y en la segunda el foco ya está en "Seguir editando";
    // si se volviera a guardar, al elegirlo el foco se perdería.
    if (!focoAnterior.current) focoAnterior.current = document.activeElement as HTMLElement | null;
    contenedor.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, []);

  return (
    <div ref={contenedor} className={styles.avisoSinGuardar} role="alert">
      <p className={styles.avisoTexto}>Tienes cambios sin guardar. Si sales ahora, se pierden.</p>
      <div className={styles.avisoAcciones}>
        <Boton
          variante="secundario"
          tamano="s"
          onClick={() => {
            const anterior = focoAnterior.current;
            onSeguirEditando();
            anterior?.focus?.();
          }}
        >
          Seguir editando
        </Boton>
        <Boton variante="peligro" tamano="s" onClick={onDescartar}>
          Descartar cambios
        </Boton>
      </div>
    </div>
  );
}

export default AvisoCambiosSinGuardar;
