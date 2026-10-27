import { useEffect, type RefObject } from "react";

/**
 * Pide confirmación al cerrar o recargar la pestaña mientras `hayCambios`
 * sea true (CH-16). El navegador muestra su propio diálogo genérico: los
 * navegadores actuales ya no permiten personalizar el texto.
 *
 * Recibe una ref (no un booleano) para no volver a registrar el listener
 * en cada tecla que cambia el estado del formulario.
 */
export function useAvisoAlSalir(hayCambios: RefObject<boolean>) {
  useEffect(() => {
    function alSalir(e: BeforeUnloadEvent) {
      if (!hayCambios.current) return;
      e.preventDefault();
      // Chrome y Edge todavía exigen returnValue para mostrar el diálogo.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", alSalir);
    return () => window.removeEventListener("beforeunload", alSalir);
  }, [hayCambios]);
}
