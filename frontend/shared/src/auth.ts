export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let apiUrl = "http://localhost:8000";
let endpoints = {
  login: "/api/auth/login/",
  register: "/api/auth/register/",
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
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  usuario: { id: string; nombre: string; correo: string };
};

export function login(payload: LoginPayload): Promise<AuthResponse> {
  return postJSON<AuthResponse>(endpoints.login, {
    email: payload.correo,
    password: payload.password,
  });
}

export function register(payload: RegisterPayload): Promise<AuthResponse> {
  return postJSON<AuthResponse>(endpoints.register, {
    // OJO: `nombre` puede desaparecer del modelo User — ver la nota de
    // arriba. Si eso pasa, sacar esta línea (y el campo del formulario).
    nombre: payload.nombre,
    email: payload.correo,
    password: payload.password,
  });
}