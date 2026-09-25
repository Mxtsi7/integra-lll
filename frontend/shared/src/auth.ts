export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let apiUrl = "http://localhost:8000/api";
let endpoints = {
  login: "/auth/login/",
  register: "/auth/register/",
};

export function configureAuthApi(config: {
  baseUrl?: string;
  endpoints?: Partial<typeof endpoints>;
}) {
  if (config.baseUrl) apiUrl = config.baseUrl;
  if (config.endpoints) endpoints = { ...endpoints, ...config.endpoints };
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

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
    throw new AuthError(message, res.status);
  }

  return res.json() as Promise<T>;
}

export type LoginPayload = { correo: string; password: string };

export type RegisterPayload = {
  nombre: string;
  correo: string;
  password: string;
  aceptaDatos: boolean;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  usuario: { id: number; nombre: string; correo: string };
};

export type RegisterResponse = {
  id: number;
  email: string;
  nombre: string;
};

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return postJSON<AuthResponse>(endpoints.login, {
    email: payload.correo,
    password: payload.password,
  });
}

export function register(payload: RegisterPayload): Promise<RegisterResponse> {
  return postJSON<RegisterResponse>(endpoints.register, {
    nombre: payload.nombre,
    email: payload.correo,
    password: payload.password,
    acepta_datos: payload.aceptaDatos,
  });
}
type TokenStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const memoria: Record<string, string> = {};
let storage: TokenStorage =
  typeof localStorage !== "undefined"
    ? localStorage
    : {
        getItem: (k: string) => memoria[k] ?? null,
        setItem: (k: string, v: string) => {
          memoria[k] = v;
        },
        removeItem: (k: string) => {
          delete memoria[k];
        },
      };

export function configurarTokenStorage(s: TokenStorage) {
  storage = s;
}

const ACCESS_TOKEN_KEY = "access_token";
const REFRESH_TOKEN_KEY = "refresh_token";

export function guardarTokens(tokens: {
  access_token: string;
  refresh_token: string;
}) {
  storage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
}

export function obtenerAccessToken(): string | null {
  return storage.getItem(ACCESS_TOKEN_KEY);
}

export function obtenerRefreshToken(): string | null {
  return storage.getItem(REFRESH_TOKEN_KEY);
}

export function hayTokenGuardado(): boolean {
  return obtenerAccessToken() !== null;
}

export function logout() {
  storage.removeItem(ACCESS_TOKEN_KEY);
  storage.removeItem(REFRESH_TOKEN_KEY);
}