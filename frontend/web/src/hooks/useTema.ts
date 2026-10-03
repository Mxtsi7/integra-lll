import { useEffect, useState } from 'react';

export type Tema = 'claro' | 'oscuro';

const CLAVE = 'oag-tema';

function leerTemaGuardado(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === 'claro' || guardado === 'oscuro') return guardado;
  } catch {
    
  }
  return 'claro';
}

export function aplicarTema(tema: Tema) {
  document.documentElement.dataset.tema = tema;
}

// Llamar UNA vez en main.tsx, antes de render, para que todas las
// páginas respeten el tema guardado (no solo Configuración).
export function iniciarTema() {
  aplicarTema(leerTemaGuardado());
}

export function useTema() {
  const [tema, setTema] = useState<Tema>(leerTemaGuardado);

  useEffect(() => {
    aplicarTema(tema);
    try {
      localStorage.setItem(CLAVE, tema);
    } catch {
      // ignoramos errores de almacenamiento
    }
  }, [tema]);

  return [tema, setTema] as const;
}