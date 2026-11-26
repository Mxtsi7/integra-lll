/**
 * Recuerda en este navegador el intento de contratación, para no perderlo si se cierra la pestaña
 * con un pago pendiente. Solo guarda la clave y el id: nada de esto concede permisos; sirve para
 * volver a preguntarle al servidor cómo va.
 *
 * Aislamiento: cada persona y organización tiene su propia entrada, y además se comprueba el
 * `alcance` guardado antes de usarlo.
 */

const PREFIJO_CLAVE = 'contratacion_pendiente_';

export interface IntentoGuardado {
  /** Clave de idempotencia del intento. Reenviarla devuelve la misma contratación. */
  clave: string;
  /** Null si la respuesta del servidor se perdió antes de conocer el id. */
  contratoId: string | null;
}

export interface AlmacenIntento {
  leer(): IntentoGuardado | null;
  guardar(intento: IntentoGuardado): void;
  borrar(): void;
}

function almacenamientoDelNavegador(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // algunos navegadores bloquean el acceso con error
  }
}

/**
 * Un fallo del almacenamiento nunca rompe la pantalla: leer devuelve "no hay nada" y guardar o borrar
 * se ignoran. En ese caso solo se pierde la recuperación; la contratación sigue funcionando.
 */
export function crearAlmacenIntento(
  alcance: string,
  obtenerAlmacenamiento: () => Storage | null = almacenamientoDelNavegador,
): AlmacenIntento {
  const claveDeAlmacenamiento = `${PREFIJO_CLAVE}${alcance}`;
  return {
    leer() {
      try {
        const texto = obtenerAlmacenamiento()?.getItem(claveDeAlmacenamiento);
        if (!texto) return null;
        const datos = JSON.parse(texto) as { alcance?: unknown; clave?: unknown; contratoId?: unknown };
        if (datos.alcance !== alcance || typeof datos.clave !== 'string' || !datos.clave) return null;
        return { clave: datos.clave, contratoId: typeof datos.contratoId === 'string' ? datos.contratoId : null };
      } catch {
        return null;
      }
    },
    guardar(intento) {
      try {
        obtenerAlmacenamiento()?.setItem(claveDeAlmacenamiento, JSON.stringify({ alcance, ...intento }));
      } catch {
        /* sin almacenamiento solo se pierde la recuperación */
      }
    },
    borrar() {
      try {
        obtenerAlmacenamiento()?.removeItem(claveDeAlmacenamiento);
      } catch {
        /* ídem */
      }
    },
  };
}
