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
  // Revocación de la sesión en el backend (MX-29). Contrato acordado:
  // POST { refresh_token } → 2xx si quedó revocado. Configurable con
  // configureAuthApi({ endpoints: { logout } }) si el backend usa otra ruta.
  logout: "/auth/logout/",
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
const DESFASE_RELOJ_KEY = "desfase_reloj_ms";

export function guardarTokens(tokens: {
  access_token: string;
  refresh_token: string;
}) {
  storage.setItem(ACCESS_TOKEN_KEY, tokens.access_token);
  storage.setItem(REFRESH_TOKEN_KEY, tokens.refresh_token);
  // Se agregó: además de los tokens se guarda cuánto difiere el reloj de
  // este equipo del reloj del servidor (ver desfaseReloj más abajo).
  guardarDesfaseReloj(tokens.access_token);
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
  storage.removeItem(DESFASE_RELOJ_KEY);
}

// ── Validez de la sesión ──────────────────────────────────────────────
// `hayTokenGuardado()` solo dice si hay *algo* guardado. Al recargar la
// página eso no alcanza: el access token puede estar vencido (dura 30 min,
// ver JWT_MINUTOS_ACCESO en el servicio auth) o ser basura. Por eso se lee
// el claim `exp` del JWT.
//
// Esto NO verifica la firma (eso solo lo puede hacer el gateway): es una
// comprobación barata para no mostrar pantallas privadas con un token que
// ya sabemos inservible. Si el token parece válido pero el backend lo
// rechaza, el interceptor 401 de `pedir()` cierra la sesión igual.

// Margen para no dar por buena una sesión a segundos de vencer: la
// petición que viene después llegaría al gateway con el token ya vencido.
const MARGEN_EXPIRACION_MS = 10_000;

function decodificarPayloadJwt(token: string): Record<string, unknown> | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    // El payload viene en base64url: se pasa a base64 normal y se le
    // repone el padding que el JWT omite, porque atob() lo exige.
    const base64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const conPadding = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const datos: unknown = JSON.parse(atob(conPadding));
    return typeof datos === "object" && datos !== null
      ? (datos as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// ── Desfase de reloj ──────────────────────────────────────────────────
// `exp` está en hora del SERVIDOR, pero Date.now() es la hora de ESTE
// equipo. Si el reloj del PC va 40 min adelantado, un token recién emitido
// (dura 30 min) parecería vencido y el usuario no podría entrar nunca.
// Al guardar los tokens se compara el claim `iat` (cuándo lo emitió el
// servidor) con la hora local; esa diferencia se suma al revisar `exp`.
// La latencia de red mete unos segundos de error, que cubre el margen.

function guardarDesfaseReloj(accessToken: string) {
  const payload = decodificarPayloadJwt(accessToken);
  if (payload && typeof payload.iat === "number") {
    storage.setItem(DESFASE_RELOJ_KEY, String(payload.iat * 1000 - Date.now()));
  } else {
    storage.removeItem(DESFASE_RELOJ_KEY);
  }
}

function desfaseReloj(): number {
  const valor = Number(storage.getItem(DESFASE_RELOJ_KEY));
  return Number.isFinite(valor) ? valor : 0;
}

/**
 * true si el token no es un JWT legible o si su `exp` ya pasó (o pasa
 * dentro del margen). Un JWT sin `exp` se da por vigente: en ese caso
 * decide el backend.
 */
export function tokenExpirado(token: string, ahoraMs: number = Date.now()): boolean {
  const payload = decodificarPayloadJwt(token);
  if (!payload) return true;
  if (typeof payload.exp !== "number") return false;
  return payload.exp * 1000 <= ahoraMs + MARGEN_EXPIRACION_MS;
}

/**
 * Hay un access token guardado y no está vencido según la hora del
 * servidor (hora local + desfase medido en el login). No toca el storage.
 */
export function haySesionValida(ahoraMs: number = Date.now()): boolean {
  const token = obtenerAccessToken();
  return token !== null && !tokenExpirado(token, ahoraMs + desfaseReloj());
}

// ── Revocación de la sesión en el backend ─────────────────────────────
// Borrar los tokens locales no invalida el refresh token: sigue sirviendo
// en el servidor hasta que vence (7 días). Por eso, al cerrar sesión, se
// le pide al backend que lo revoque.

// Cerrar sesión no puede quedar colgado si el servidor no responde.
const TIEMPO_MAX_REVOCACION_MS = 5_000;

/**
 * Pide al backend que revoque la sesión actual. NO borra los tokens
 * locales (eso lo hace logout() después) y nunca lanza: el logout local
 * tiene que ocurrir igual aunque esto falle.
 *
 * Devuelve true si el servidor confirmó la revocación (2xx) o si el token
 * ya no valía (401: no hay sesión que revocar). Devuelve false si no se
 * pudo confirmar: sin red, timeout, 5xx o un endpoint que aún no existe (404).
 *
 * Usa fetch directo y no pedir() a propósito: un 401 acá no debe disparar
 * el aviso de "Tu sesión expiró".
 */
export async function revocarSesion(): Promise<boolean> {
  const refresh = obtenerRefreshToken();
  if (!refresh) return true; // no hay sesión guardada que revocar

  const access = obtenerAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (access) headers.Authorization = `Bearer ${access}`;

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAX_REVOCACION_MS);
  try {
    const res = await fetch(`${apiUrl}${endpoints.logout}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refresh_token: refresh }),
      signal: controlador.signal,
    });
    return res.ok || res.status === 401;
  } catch {
    return false; // sin red, CORS o timeout (AbortError)
  } finally {
    clearTimeout(temporizador);
  }
}
