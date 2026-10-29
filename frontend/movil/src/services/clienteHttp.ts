import { Platform } from 'react-native';
import {
  configurarApi,
  configureAuthApi,
  AuthError,
  ErrorDeApi,
} from '@ojoalgasto/shared';

export interface ValidacionUrlApi {
  valida: boolean;
  urlNormalizada: string;
  error?: string;
  advertencia?: string;
}

export interface ResultadoErrorHttp {
  esRed: boolean;
  esDominio: boolean;
  mensaje: string;
  status?: number;
  campos?: Record<string, string[]>;
  codigo?: string;
}

export const MENSAJE_ERROR_RED =
  'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.';

/**
 * Retorna la URL por defecto según la plataforma móvil en ejecución.
 * En emuladores Android, 'localhost' es el teléfono; el host del PC es 10.0.2.2.
 */
export function obtenerDefaultApiUrl(plataforma: string = Platform.OS): string {
  if (plataforma === 'android') {
    return 'http://10.0.2.2:8000/api';
  }
  return 'http://localhost:8000/api';
}

/**
 * Normaliza la URL eliminando espacios y barras finales superfluas.
 */
export function normalizarUrlApi(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * Valida si la URL de API es sintácticamente correcta y alerta sobre problemas
 * comunes en dispositivos móviles (e.g., localhost en celulares reales).
 */
export function validarUrlApi(
  url: string,
  opciones: { plataforma?: string } = {}
): ValidacionUrlApi {
  const plataforma = opciones.plataforma ?? Platform.OS;
  const normalizada = normalizarUrlApi(url);

  if (!normalizada) {
    return {
      valida: false,
      urlNormalizada: '',
      error: 'La URL de la API no puede estar vacía.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizada);
  } catch {
    return {
      valida: false,
      urlNormalizada: normalizada,
      error: `Formato de URL inválido: '${normalizada}'. Debe incluir protocolo (http:// o https://).`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      valida: false,
      urlNormalizada: normalizada,
      error: `Protocolo no soportado '${parsed.protocol}'. Solo se admiten 'http:' y 'https:'.`,
    };
  }

  let advertencia: string | undefined;

  const esLoopback =
    parsed.hostname === 'localhost' ||
    parsed.hostname === '127.0.0.1' ||
    parsed.hostname === '::1';

  if (esLoopback && plataforma === 'android') {
    advertencia =
      "En Android, 'localhost' apunta al propio emulador/teléfono y fallará al contactar tu PC. Usa 'http://10.0.2.2:8000/api' para emulador oficial o tu IP LAN (ej. 'http://192.168.1.X:8000/api') en dispositivo físico.";
  }

  if (!parsed.pathname || parsed.pathname === '/' || !parsed.pathname.includes('/api')) {
    advertencia =
      advertencia ??
      "La URL del Gateway debería apuntar a la ruta base '/api' (ej. 'http://.../api').";
  }

  return {
    valida: true,
    urlNormalizada: normalizada,
    advertencia,
  };
}

/**
 * Determina la URL base a utilizar considerando EXPO_PUBLIC_API_URL o el fallback del entorno.
 */
export function obtenerApiUrlConfigurada(envUrl?: string): string {
  const rawUrl = envUrl ?? process.env.EXPO_PUBLIC_API_URL;
  if (rawUrl && rawUrl.trim().length > 0) {
    return normalizarUrlApi(rawUrl);
  }
  return obtenerDefaultApiUrl();
}

let urlBaseActual: string = '';

/**
 * Configura los clientes HTTP de shared (recursos de API y autenticación)
 * garantizando que ambos consuman el MISMO Gateway configurado por entorno.
 */
export function configurarClienteHttp(urlPersonalizada?: string): {
  urlBase: string;
  advertencia?: string;
} {
  const urlBase = normalizarUrlApi(
    urlPersonalizada ?? obtenerApiUrlConfigurada()
  );

  const validacion = validarUrlApi(urlBase);
  if (!validacion.valida) {
    throw new Error(
      `[Cliente HTTP Móvil] Error al configurar API: ${validacion.error}`
    );
  }

  // Configuración sincronizada en shared: Login y API usan el mismo Gateway
  configurarApi({ urlBase });
  configureAuthApi({ baseUrl: urlBase });
  urlBaseActual = urlBase;

  return {
    urlBase,
    advertencia: validacion.advertencia,
  };
}

/**
 * Retorna la URL base activa configurada en el cliente.
 */
export function obtenerUrlBaseConfigurada(): string {
  return urlBaseActual || obtenerApiUrlConfigurada();
}

/**
 * Identifica si un error corresponde a un fallo de red o conectividad,
 * distinguiéndolo de errores de dominio o del servidor (4xx / 5xx).
 */
export function esErrorDeRed(error: unknown): boolean {
  if (!error) return false;

  // Los errores de dominio tipados de shared nunca son fallos puros de red
  if (error instanceof AuthError || error instanceof ErrorDeApi) {
    return false;
  }

  if (error instanceof TypeError) {
    return true;
  }

  if (error instanceof Error) {
    if (error.name === 'TypeError' || error.name === 'AbortError') {
      return true;
    }
    const msg = error.message.toLowerCase();
    if (
      msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('network error') ||
      msg.includes('networkerror') ||
      msg.includes('econnrefused') ||
      msg.includes('aborted') ||
      msg.includes('timeout')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Adapta errores de red a un mensaje legible para el usuario.
 * Retorna null si el error NO es de red, permitiendo que la lógica
 * de dominio de cada pantalla actúe sin alteraciones.
 */
export function adaptarErrorRed(
  error: unknown,
  mensajePersonalizado: string = MENSAJE_ERROR_RED
): string | null {
  if (esErrorDeRed(error)) {
    return mensajePersonalizado;
  }
  return null;
}

/**
 * Procesa un error HTTP de manera unificada sin duplicar lógica de dominio:
 * - Fallos de red -> adaptados con mensaje de reintento/conexión.
 * - Errores de autenticación (AuthError) -> preserva mensaje, status y campos del backend.
 * - Errores de API (ErrorDeApi) -> preserva mensaje, status y campos de validación.
 * - Otros errores -> mensaje de la excepción o fallback.
 */
export function procesarErrorHttp(
  error: unknown,
  fallback: string = 'Ocurrió un error inesperado'
): ResultadoErrorHttp {
  if (error instanceof AuthError) {
    return {
      esRed: false,
      esDominio: true,
      mensaje: error.message,
      status: error.status,
      campos: error.campos,
      codigo: error.codigo,
    };
  }

  if (error instanceof ErrorDeApi) {
    return {
      esRed: false,
      esDominio: true,
      mensaje: error.message,
      status: error.status,
      campos: error.campos,
    };
  }

  if (esErrorDeRed(error)) {
    return {
      esRed: true,
      esDominio: false,
      mensaje: MENSAJE_ERROR_RED,
    };
  }

  return {
    esRed: false,
    esDominio: false,
    mensaje: error instanceof Error ? error.message : fallback,
  };
}
