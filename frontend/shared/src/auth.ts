export class AuthError extends Error {
  status: number;
  /** `code` del cuerpo, si viene (p. ej. "token_expirado" en recuperación). */
  codigo?: string;
  /**
   * Errores por campo tal como los manda DRF: { campo: ["mensaje", …] }.
   * Antes solo se guardaba el primer mensaje y se perdían los demás; el
   * registro (CH-04) los necesita para mostrarlos bajo cada campo.
   */
  campos?: Record<string, string[]>;
  constructor(
    message: string,
    status: number,
    extra: { codigo?: string; campos?: Record<string, string[]> } = {},
  ) {
    super(message);
    this.status = status;
    this.codigo = extra.codigo;
    this.campos = extra.campos;
  }
}

// Sin valor por defecto a propósito (VI-14): en un teléfono `localhost` es el
// propio teléfono, no la máquina de desarrollo. Cada cliente debe configurar
// la URL real del gateway al arrancar con configureAuthApi({ baseUrl }).
let apiUrl = "";
let endpoints = {
  login: "/auth/login/",
  register: "/auth/register/",
  // Contrato de refresh (MX-29 / VI-16): POST { refresh_token } → 200 con
  // access_token y un refresh_token NUEVO (rotación). No exige access.
  refresh: "/auth/refresh/",
  // Revocación de la sesión en el backend (MX-29). Contrato acordado:
  // POST { refresh_token } → 2xx si quedó revocado. Configurable con
  // configureAuthApi({ endpoints: { logout } }) si el backend usa otra ruta.
  logout: "/auth/logout/",
  // Recuperación de contraseña (MX-02 / MX-04). Rutas públicas del gateway.
  passwordReset: "/auth/password-reset/",
  passwordResetConfirm: "/auth/password-reset/confirm/",
  emailVerificationConfirm: "/auth/email-verification/confirm/",
};

export function configureAuthApi(config: {
  baseUrl?: string;
  endpoints?: Partial<typeof endpoints>;
}) {
  if (config.baseUrl) apiUrl = config.baseUrl;
  if (config.endpoints) endpoints = { ...endpoints, ...config.endpoints };
}

/**
 * URL base configurada. Si nadie la configuró, no se inventa una: el error
 * explica qué falta en vez de mandar la petición al localhost del teléfono.
 */
function urlApi(): string {
  if (!apiUrl) {
    throw new AuthError(
      "API sin configurar: llamar configureAuthApi({ baseUrl }) al iniciar la app",
      0,
    );
  }
  return apiUrl;
}

/** true si configureAuthApi ya recibió una URL. Útil para scripts y tests. */
export function apiConfigurada(): boolean {
  return apiUrl !== "";
}

async function postJSON<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${urlApi()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = "Ocurrió un error inesperado";
    let codigo: string | undefined;
    let campos: Record<string, string[]> | undefined;
    try {
      const data = (await res.json()) as Record<string, unknown>;
      if (typeof data.code === "string") codigo = data.code;
      campos = camposDesdeCuerpo(data);
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
    throw new AuthError(message, res.status, { codigo, campos });
  }

  return res.json() as Promise<T>;
}

// Errores de validación de DRF: cada clave trae una lista de mensajes. Se
// ignoran las claves de control (detail, code, solicitar_nuevo_enlace).
const CLAVES_NO_CAMPO = new Set(["detail", "code", "solicitar_nuevo_enlace"]);

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

// ── Renovación de la sesión (VI-16) ───────────────────────────────────
// Contrato de MX-29:
//   · POST /auth/refresh/ { refresh_token } → 200 { access_token, refresh_token }
//     El refresh rota: hay que guardar LOS DOS tokens antes de reintentar.
//   · 401: el refresh no sirve → se descarta la sesión y se vuelve al login.
//   · 503: indisponibilidad temporal → se conservan los tokens y se reintenta
//     con una espera acotada.
//
// Una sola renovación en vuelo por cada refresh token: si cinco peticiones
// reciben 401 a la vez con el mismo refresh, comparten la misma promesa. Si
// el refresh cambió (nuevo login o logout) antes de que resuelva, se inicia
// una nueva operación independiente para no sobreescribir la sesión activa.
// En web, además, se usa navigator.locks para que dos pestañas no quemen el
// mismo refresh (el segundo cerraría la familia de tokens). Al tomar el turno
// se releen los tokens del storage por si otra pestaña ya renovó.


const TIEMPO_MAX_RENOVACION_MS = 8_000;
const ESPERA_REINTENTO_503_MS = 200;
const MAX_INTENTOS_RENOVACION = 2;

type ResultadoRefresh =
  | { tipo: "ok"; access: string; refresh: string }
  | { tipo: "invalido" }
  | { tipo: "temporal"; reintentable: boolean };

// La renovación se asocia al refresh token con el que se inició: si al
// llegar la respuesta el storage ya cambió (login de otro usuario, logout),
// la respuesta tardía no se instala. La clave de deduplicación es el propio
// refresh token; dos sesiones distintas generan entradas distintas.
const renovacionesPorRefresh = new Map<string, Promise<boolean>>();

/**
 * Intenta renovar el par de tokens. Devuelve true sólo si hay un access
 * token nuevo guardado y listo para usar.
 *
 * No lanza: un fallo de red o un 503 devuelve false y **conserva** los
 * tokens (se podrá reintentar); un 400/401/403 los borra porque el refresh
 * ya no sirve. Nunca se reintenta un 401: insistir sólo consume la familia.
 *
 * Dos llamadas concurrentes con el mismo refresh comparten una sola promesa.
 * Si el refresh cambió (nuevo login, logout), se inicia una renovación
 * independiente para ese refresh en vez de heredar la del anterior.
 */
export function renovarSesion(): Promise<boolean> {
  const refreshActual = obtenerRefreshToken();
  if (!refreshActual) return Promise.resolve(false);

  const enCurso = renovacionesPorRefresh.get(refreshActual);
  if (enCurso) return enCurso;

  const accessAntes = obtenerAccessToken();
  const operacion = conBloqueoDePestanas(() =>
    renovarConTurno(accessAntes, refreshActual),
  ).finally(() => {
    if (renovacionesPorRefresh.get(refreshActual) === operacion) {
      renovacionesPorRefresh.delete(refreshActual);
    }
  });
  renovacionesPorRefresh.set(refreshActual, operacion);
  return operacion;
}

async function renovarConTurno(
  accessAntes: string | null,
  refreshEsperado: string,
): Promise<boolean> {
  if (!apiConfigurada()) {
    // Sin URL no hay forma de renovar; conservar tokens sólo alargaría una
    // sesión que ya no se puede usar.
    logout();
    return false;
  }

  const refresh = obtenerRefreshToken();
  // El refresh en storage cambió (logout, nuevo login) antes de tomar el
  // turno: esta operación ya no corresponde a la sesión activa.
  if (!refresh || refresh !== refreshEsperado) return false;

  const accessActual = obtenerAccessToken();
  if (
    accessActual !== null &&
    accessActual !== accessAntes &&
    !tokenExpirado(accessActual, Date.now() + desfaseReloj())
  ) {
    return true; // otra pestaña ya renovó mientras esperábamos el turno
  }

  for (let intento = 0; intento < MAX_INTENTOS_RENOVACION; intento++) {
    if (intento > 0) {
      await new Promise((resolver) => setTimeout(resolver, ESPERA_REINTENTO_503_MS));
    }

    const resultado = await enviarRefresh(refresh);
    if (resultado.tipo === "ok") {
      // Antes de instalar los tokens nuevos, verificar que el refresh en
      // storage sigue siendo el mismo: si entre el envío y la respuesta el
      // usuario hizo logout o inició sesión con otra cuenta, esta respuesta
      // tardía no debe sobreescribir la sesión activa.
      if (obtenerRefreshToken() !== refreshEsperado) return false;
      guardarTokens({
        access_token: resultado.access,
        refresh_token: resultado.refresh,
      });
      return true;
    }
    if (resultado.tipo === "invalido") {
      // Solo revocar si el refresh sigue siendo el que iniciamos nosotros.
      if (obtenerRefreshToken() === refreshEsperado) logout();
      return false;
    }
    // temporal: sólo se reintenta un 503 declarado. Perder la respuesta de
    // un 200 en la red no se puede distinguir de un fallo, y repetir el
    // refresh consumido cerraría la familia.
    if (!resultado.reintentable || intento + 1 >= MAX_INTENTOS_RENOVACION) {
      return false;
    }
  }
  return false;
}

async function enviarRefresh(refresh: string): Promise<ResultadoRefresh> {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAX_RENOVACION_MS);
  try {
    const res = await fetch(`${urlApi()}${endpoints.refresh}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refresh }),
      signal: controlador.signal,
    });

    if (res.ok) {
      const datos = (await res.json()) as Record<string, unknown>;
      if (
        typeof datos.access_token === "string" &&
        datos.access_token !== "" &&
        typeof datos.refresh_token === "string" &&
        datos.refresh_token !== ""
      ) {
        return {
          tipo: "ok",
          access: datos.access_token,
          refresh: datos.refresh_token,
        };
      }
      // Un 200 fuera de contrato no es un 503: no se puede reintentar a
      // ciegas con el mismo refresh.
      return { tipo: "temporal", reintentable: false };
    }

    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { tipo: "invalido" };
    }
    return { tipo: "temporal", reintentable: res.status === 503 };
  } catch {
    // Sin red, CORS o timeout (AbortError): conservar los tokens.
    return { tipo: "temporal", reintentable: false };
  } finally {
    clearTimeout(temporizador);
  }
}

type BloqueoDePestanas = {
  request<T>(nombre: string, callback: () => Promise<T>): Promise<T>;
};

/** Serializa la renovación entre pestañas cuando el navegador lo permite. */
async function conBloqueoDePestanas<T>(fn: () => Promise<T>): Promise<T> {
  const navegador = (globalThis as { navigator?: { locks?: BloqueoDePestanas } }).navigator;
  if (navegador?.locks && typeof navegador.locks.request === "function") {
    return navegador.locks.request("ojoalgasto:refresh", fn);
  }
  return fn();
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
 * Devuelve true SOLO si el servidor confirmó la revocación (2xx). Cualquier
 * otra cosa es "no confirmada" (false): sin red, timeout, 5xx, un endpoint
 * que aún no existe (404) y también 401/403. Antes un 401 contaba como
 * revocada, pero un 401 no garantiza que el refresh token haya quedado
 * invalidado (p. ej. lo pudo provocar un access token vencido), así que se
 * trata como no confirmada mientras el contrato de MX-29 no diga lo contrario.
 *
 * Usa fetch directo y no pedir() a propósito: un 401 acá no debe disparar
 * el aviso de "Tu sesión expiró".
 */
export async function revocarSesion(): Promise<boolean> {
  const refresh = obtenerRefreshToken();
  if (!refresh) return true; // no hay sesión guardada que revocar
  if (!apiConfigurada()) return false;

  const access = obtenerAccessToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // Solo se manda el access token si sigue vigente: un JWT vencido en el
  // header hace que DRF responda 401 aunque el endpoint no exija login, y
  // eso dejaría la revocación como "no confirmada" sin motivo. La sesión a
  // revocar la identifica el refresh token del body.
  if (access && haySesionValida()) headers.Authorization = `Bearer ${access}`;

  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAX_REVOCACION_MS);
  try {
    const res = await fetch(`${urlApi()}${endpoints.logout}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ refresh_token: refresh }),
      signal: controlador.signal,
    });
    return res.ok;
  } catch {
    return false; // sin red, CORS o timeout (AbortError)
  } finally {
    clearTimeout(temporizador);
  }
}

// ── Recuperación de contraseña (CH-06 / CH-07) ────────────────────────

/**
 * POST /auth/password-reset/ (MX-02). El backend responde lo mismo exista o
 * no el correo (anti-enumeración): siempre 200 con un mensaje neutro.
 * Lanza AuthError (400 si el correo está mal formado) o TypeError sin red.
 */
export function solicitarRecuperacion(correo: string): Promise<{ detail: string }> {
  return postJSON<{ detail: string }>(endpoints.passwordReset, { email: correo.trim() });
}

/** `code` que manda el backend cuando el enlace de recuperación no sirve (MX-04). */
export type CodigoErrorEnlace = "token_invalido" | "token_expirado" | "token_usado";

/**
 * POST /auth/password-reset/confirm/ (MX-04). Cambia la contraseña con el
 * token del enlace; el backend revoca las sesiones abiertas y NO inicia
 * sesión. Errores (AuthError):
 * - 400 code=token_invalido · 410 code=token_expirado | token_usado
 * - 400 sin code y con campos.password: la clave no cumple la política
 * - 503: no se pudo completar; la contraseña no cambió
 */
export async function restablecerContrasena(token: string, password: string): Promise<void> {
  await postJSON<{ detail: string }>(endpoints.passwordResetConfirm, { token, password });
}
  /**
   * POST /auth/email-verification/confirm/ (MX-28). Ruta pública. Errores (AuthError):
   * - 400 code=token_invalido | correo_no_disponible · 410 code=token_expirado | token_usado
   * - 503: el aviso falló y el enlace sigue siendo reutilizable
   */
export async function confirmarCorreo(token: string): Promise<void> {
  await postJSON<{ detail: string }>(endpoints.emailVerificationConfirm, { token });
}
