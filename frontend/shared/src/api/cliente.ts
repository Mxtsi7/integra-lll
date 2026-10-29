import { obtenerAccessToken, obtenerRefreshToken, logout, renovarSesion } from "../auth";

let urlBase = "";

export function configurarApi(config: { urlBase: string }) {
  urlBase = config.urlBase.replace(/\/+$/, "");
}

export class ErrorDeApi extends Error {
  status: number;
  /**
   * Errores de validación por campo tal como los manda DRF:
   * { campo: ["mensaje", …] }. Los formularios los usan para mostrar cada
   * error junto a su campo (CH-09, CH-14); antes solo llegaba el primero.
   */
  campos?: Record<string, string[]>;
  constructor(message: string, status: number, campos?: Record<string, string[]>) {
    super(message);
    this.status = status;
    this.campos = campos;
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

  // VI-16: un 401 con un token guardado puede ser sólo un access vencido.
  // Se intenta renovar UNA vez y se repite la petición con el token nuevo.
  // Si la renovación falla por red o 503, `renovarSesion()` conserva los
  // tokens: no se cierra la sesión y la UI muestra el error de red en vez de
  // datos viejos. Sólo se conserva si el token rechazado sigue siendo el
  // actual; si el usuario volvió a entrar mientras viajaba la petición, el
  // 401 es del token viejo y no hay nada que renovar.
  if (res.status === 401 && token !== null && obtenerAccessToken() === token) {
    const renovado = await renovarSesion();
    if (renovado) {
      tokenUsado = obtenerAccessToken();
      res = await enviar(tokenUsado);
    } else if (obtenerRefreshToken() === null) {
      // El refresh fue rechazado: renovarSesion ya borró los tokens.
      manejadorNoAutorizado?.();
      notificado = true;
    } else {
      // Fallo temporal (red/503): los tokens siguen guardados.
      conservarSesion = true;
    }
  }

  // Solo se cierra la sesión si el token rechazado sigue siendo el actual.
  // Si mientras la petición viajaba el usuario cerró sesión y volvió a
  // entrar, el 401 corresponde al token VIEJO: borrar los tokens nuevos
  // echaría a alguien que acaba de iniciar sesión bien.
  if (
    res.status === 401 &&
    !notificado &&
    !conservarSesion &&
    obtenerAccessToken() === tokenUsado
  ) {
    logout();
    manejadorNoAutorizado?.();
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
    throw new ErrorDeApi(message, res.status, campos);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}