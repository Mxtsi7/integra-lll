/**
 * Guarda el intento de contratación en el teléfono para que no se pierda al salir de la pantalla,
 * cerrar la app o perder la respuesta del servidor (AN-08).
 *
 * Qué se guarda: la clave de idempotencia y, cuando ya se conoce, el id de la contratación.
 * Nada de esto da permisos: solo permite volver a preguntarle al servidor cómo va el pago.
 *
 * Aislamiento: cada persona/organización tiene su propia entrada y, además, lo guardado lleva
 * su `alcance`; si no coincide con el de quien está usando la app, se ignora.
 */

/** Lo mínimo que necesita del almacenamiento seguro (lo cumple expo-secure-store). */
export interface BackendAlmacen {
  getItemAsync(clave: string): Promise<string | null>;
  setItemAsync(clave: string, valor: string): Promise<void>;
  deleteItemAsync(clave: string): Promise<void>;
}

export interface IntentoGuardado {
  /** Clave que identifica el intento. La misma clave devuelve la misma contratación. */
  clave: string;
  /** Todavía es null si la respuesta del servidor se perdió antes de conocer el id. */
  contratoId: string | null;
}

export interface AlmacenIntento {
  leer(): Promise<IntentoGuardado | null>;
  guardar(intento: IntentoGuardado): Promise<void>;
  borrar(): Promise<void>;
}

/** SecureStore solo acepta letras, números, ".", "-" y "_" en la clave. */
function nombreDeClave(alcance: string): string {
  return `contratacion_pendiente_${alcance.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/**
 * `alcance` identifica a quien usa la app (por ejemplo `${usuario.id}:${usuario.organizacion_id}`).
 * Un fallo del almacenamiento nunca rompe la pantalla: leer devuelve "no hay nada" y guardar/borrar
 * se ignoran (en ese caso solo se pierde la recuperación, no se pone en riesgo nada).
 */
export function crearAlmacenIntento(alcance: string, backend: BackendAlmacen): AlmacenIntento {
  const nombre = nombreDeClave(alcance);
  return {
    async leer() {
      try {
        const texto = await backend.getItemAsync(nombre);
        if (!texto) return null;
        const datos = JSON.parse(texto) as { alcance?: unknown; clave?: unknown; contratoId?: unknown };
        if (datos.alcance !== alcance || typeof datos.clave !== 'string' || !datos.clave) return null;
        return { clave: datos.clave, contratoId: typeof datos.contratoId === 'string' ? datos.contratoId : null };
      } catch {
        return null;
      }
    },
    async guardar(intento) {
      try {
        await backend.setItemAsync(nombre, JSON.stringify({ alcance, ...intento }));
      } catch {
        /* sin almacenamiento no hay recuperación, pero la contratación sigue funcionando */
      }
    },
    async borrar() {
      try {
        await backend.deleteItemAsync(nombre);
      } catch {
        /* ídem */
      }
    },
  };
}
