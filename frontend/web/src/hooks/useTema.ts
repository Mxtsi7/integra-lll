import { useEffect, useState } from 'react';

export type Tema = 'claro' | 'oscuro';

/** Dónde se guarda el tema. index.html lo lee igual antes de pintar (CH-24). */
export const CLAVE_TEMA = 'oag-tema';

/**
 * El tema guardado por el usuario. Si nunca eligió, oscuro: la interfaz está
 * pensada en oscuro (vidrio sobre fondo profundo) y el claro es la variante.
 */
function leerTemaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE_TEMA);
    if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  } catch {
    // localStorage no disponible (p. ej. modo privado): usamos el valor por defecto
  }
  return 'oscuro';
}

export function aplicarTema(tema: Tema) {
  document.documentElement.dataset.tema = tema;
  // La barra del navegador en el teléfono toma el color del fondo del tema
  // (antes quedaba siempre oscura). Se lee del CSS para no repetir el valor.
  const fondo = getComputedStyle(document.documentElement).getPropertyValue('--fondo').trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta && fondo) meta.content = fondo;
}

// Llamar UNA vez en main.tsx, antes de render, para que todas las
// páginas respeten el tema guardado (no solo Configuración).
export function iniciarTema() {
  aplicarTema(leerTemaInicial());
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(leerTemaInicial);

  useEffect(() => {
    aplicarTema(tema);
    try {
      localStorage.setItem(CLAVE_TEMA, tema);
    } catch {
      // Sin localStorage el tema sigue aplicado, solo no se recuerda al recargar
    }
  }, [tema]);

  return [tema, setTema] as const;
}
