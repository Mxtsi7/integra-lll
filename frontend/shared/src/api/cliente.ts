import {
  obtenerAccessToken,
  obtenerRefreshToken,
  logout,
  renovarSesion,
  sesionDelToken,
} from "../auth";

/**
 * true si los dos tokens pertenecen a la misma sesión. Con tokens opacos (sin
 * claims legibles) no se puede afirmar lo contrario: la deduplicación de
 * `renovarSesion()` ya garantiza que no se comparte una operación entre
 * sesiones distintas por el valor del refresh.
 */
function mismaSesion(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const sesionA = sesionDelToken(a);
  const sesionB = sesionDelToken(b);
  if (sesionA === null || sesionB === null) return true;
  return sesionA === sesionB;
}

let urlBase = "";

export function configurarApi(config: { urlBase: string }) {
  urlBase = config.urlBase.replace(/\/+$/, "");
}

/**
 * Qué se sabe de la sesión cuando `pedir()` rechaza con un 401. Un 401 de la
 * petición original NO implica que el refresh haya sido rechazado: puede ser
 * un fallo temporal de red/503 o el rechazo de un access que ya fue rotado.
 */
export type MotivoSesionError =
  // El refresh falló por red/503/timeout: los tokens se conservaron.
  | "renovacion_temporal"
  // El refresh vigente fue rechazado: la sesión ya no sirve.
  | "sesion_rechazada"
  // El 401 corresponde a un access anterior; ya hay otro vigente.
  | "token_obsoleto"
  // No había access token con el que hacer la petición.
  | "sin_sesion";

export type ContextoSesionError = {
  motivo: MotivoSesionError;
  /** Access con el que salió la petición que terminó en 401. */
  tokenUsado: string | null;
};

export class ErrorDeApi extends Error {
  status: number;
  /**
   * Errores de validación por campo tal como los manda DRF:
   * { campo: ["mensaje", …] }. Los formularios los usan para mostrar cada
   * error junto a su campo (CH-09, CH-14); antes solo llegaba el primero.
   */
  campos?: Record<string, string[]>;
  /** Contexto de sesión cuando el error es un 401. */
  sesion?: ContextoSesionError;
  constructor(
    message: string,
    status: number,
    campos?: Record<string, string[]>,
    sesion?: ContextoSesionError,
  ) {
    super(message);
    this.status = status;
    this.campos = campos;
    this.sesion = sesion;
  }
}

export type Paginado<T> = {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
};

type ManejadorNoAutorizado = () => void;
let manejadorNoAutorizado: ManejadorNoAutorizado | null = null;

export function configurarManejador401(fn: ManejadorNoAutorizado) {
  manejadorNoAutorizado = fn;
}

type Opciones = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
};

function mensajeDesdeCuerpo(data: Record<string, unknown>): string {
  if (typeof data.detail === "string") return data.detail;
  const valores = Object.values(data);
  const primero = valores.length > 0 ? valores[0] : undefined;
  if (Array.isArray(primero) && typeof primero[0] === "string") {
    return primero[0];
  }
  if (typeof primero === "string") return primero;
  return "Ocurrió un error inesperado";
}

// Claves de control que no son campos del formulario.
const CLAVES_NO_CAMPO = new Set(["detail", "code"]);

function camposDesdeCuerpo(data: Record<string, unknown>): Record<string, string[]> | undefined {
  const campos: Record<string, string[]> = {};
  for (const [clave, valor] of Object.entries(data)) {
    if (CLAVES_NO_CAMPO.has(clave)) continue;
    if (Array.isArray(valor)) {
      const mensajes = valor.filter((m): m is string => typeof m === "string");
      if (mensajes.length > 0) campos[clave] = mensajes;
    } else if (typeof valor === "string") {
      campos[clave] = [valor];
    }
  }
  return Object.keys(campos).length > 0 ? campos : undefined;
}

export async function pedir<T>(
  path: string,
  opciones: Opciones = {},
): Promise<T> {
  if (!urlBase) {
    throw new Error(
      "API sin configurar: llamar configurarApi({ urlBase }) al iniciar la app",
    );
  }

  const token = obtenerAccessToken();

  const enviar = (autorizacion: string | null) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (autorizacion) headers.Authorization = `Bearer ${autorizacion}`;
    return fetch(`${urlBase}${path}`, {
      method: opciones.method ?? "GET",
      headers,
      body:
        opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
    });
  };

  let tokenUsado = token;
  let res = await enviar(token);
  let notificado = false;
  let conservarSesion = false;
  let motivoSesion: MotivoSesionError | undefined;

  // VI-16: un 401 con un token guardado puede ser sólo un access vencido.
  // Se intenta renovar UNA vez y se repite la petición con el token nuevo.
  // Si la renovación falla por red o 503, `renovarSesion()` conserva los
  // tokens: no se cierra la sesión y la UI muestra el error de red en vez de
  // datos viejos. Sólo se conserva si el token rechazado sigue siendo el
  // actual; si el usuario volvió a entrar mientras viajaba la petición, el
  // 401 es del token viejo y no hay nada que renovar.
  if (res.status === 401) {
    if (token === null) {
      motivoSesion = "sin_sesion";
    } else if (obtenerAccessToken() !== token) {
      // El 401 es de un access que ya fue reemplazado: no se renueva ni se
      // toca la sesión vigente.
      motivoSesion = "token_obsoleto";
    } else {
      const renovado = await renovarSesion();
      const accessRenovado = renovado ? obtenerAccessToken() : null;
      if (accessRenovado !== null && mismaSesion(token, accessRenovado)) {
        tokenUsado = accessRenovado;
        res = await enviar(tokenUsado);
      } else if (renovado) {
        // La renovación resolvió, pero el access nuevo es de otra sesión:
        // entre el 401 y la respuesta alguien volvió a entrar. Reintentar con
        // ese token usaría credenciales ajenas; la sesión nueva tampoco se
        // cierra.
        conservarSesion = true;
        motivoSesion = "token_obsoleto";
      } else if (obtenerRefreshToken() === null) {
        // El refresh fue rechazado: renovarSesion ya borró los tokens.
        manejadorNoAutorizado?.();
        notificado = true;
        motivoSesion = "sesion_rechazada";
      } else if (obtenerAccessToken() !== token) {
        // Otra operación (p. ej. otra petición de la misma sesión) rotó el
        // access mientras renovábamos. El rechazo es del token anterior.
        conservarSesion = true;
        motivoSesion = "token_obsoleto";
      } else {
        // Fallo temporal (red/503/timeout): los tokens siguen guardados.
        conservarSesion = true;
        motivoSesion = "renovacion_temporal";
      }
    }
  }

  // Solo se cierra la sesión si el token rechazado sigue siendo el actual.
  // Si mientras la petición viajaba el usuario cerró sesión y volvió a
  // entrar, el 401 corresponde al token VIEJO: borrar los tokens nuevos
  // echaría a alguien que acaba de iniciar sesión bien.
  if (res.status === 401) {
    if (
      !notificado &&
      !conservarSesion &&
      obtenerAccessToken() === tokenUsado
    ) {
      logout();
      manejadorNoAutorizado?.();
      motivoSesion = "sesion_rechazada";
    } else if (motivoSesion === undefined) {
      motivoSesion =
        obtenerAccessToken() === tokenUsado ? "sesion_rechazada" : "token_obsoleto";
    }
  }

  if (!res.ok) {
    let message = "Ocurrió un error inesperado";
    let campos: Record<string, string[]> | undefined;
    try {
      const data = (await res.json()) as Record<string, unknown>;
      message = mensajeDesdeCuerpo(data);
      campos = camposDesdeCuerpo(data);
    } catch {
      // el cuerpo no era JSON
    }
    throw new ErrorDeApi(
      message,
      res.status,
      campos,
      motivoSesion ? { motivo: motivoSesion, tokenUsado } : undefined,
    );
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}