import { obtenerAccessToken, logout } from "../auth";

let urlBase = "http://localhost:8000/api";

export function configurarApi(config: { urlBase: string }) {
  urlBase = config.urlBase;
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

export async function pedir<T>(path: string, opciones: Opciones = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const token = obtenerAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${urlBase}${path}`, {
    method: opciones.method ?? "GET",
    headers,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });

  if (res.status === 401) {
    logout(); // borra access/refresh token — el "forzar logout"
    manejadorNoAutorizado?.();
  }
  if (!res.ok) {
    let message = "Ocurrió un error inesperado";
    try {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.detail === "string") {
        message = data.detail;
      } else {
        const valores = Object.values(data);
        const primero = valores.length > 0 ? valores[0] : undefined;
        if (Array.isArray(primero) && typeof primero[0] === "string") {
          message = primero[0];
        } else if (typeof primero === "string") {
          message = primero;
        }
      }
    } catch {
      // el cuerpo no era JSON
    }
    throw new ErrorDeApi(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}