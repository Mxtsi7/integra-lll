import { obtenerAccessToken, logout } from "../auth";

let urlBase = "";

export function configurarApi(config: { urlBase: string }) {
  urlBase = config.urlBase.replace(/\/+$/, "");
}

export class ErrorDeApi extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
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
  const primero = Object.values(data)[0];
  if (Array.isArray(primero) && typeof primero[0] === "string") return primero[0];
  if (typeof primero === "string") return primero;
  return "Ocurrió un error inesperado";
}

export async function pedir<T>(path: string, opciones: Opciones = {}): Promise<T> {
  if (!urlBase) {
    throw new Error("API sin configurar: llamar configurarApi({ urlBase }) al iniciar la app");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = obtenerAccessToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${urlBase}${path}`, {
    method: opciones.method ?? "GET",
    headers,
    body: opciones.body !== undefined ? JSON.stringify(opciones.body) : undefined,
  });

  if (res.status === 401) {
    logout();
    manejadorNoAutorizado?.();
  }

  if (!res.ok) {
    let message = "Ocurrió un error inesperado";
    try {
      message = mensajeDesdeCuerpo((await res.json()) as Record<string, unknown>);
    } catch {
      // cuerpo no JSON
    }
    throw new ErrorDeApi(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}