import { Platform } from 'react-native';

/**
 * Resuelve la URL del backend para la app móvil (VI-14).
 *
 * Reglas, en este orden:
 *  1. La URL es obligatoria. No hay valor por defecto: en un teléfono
 *     `localhost` es el propio teléfono y la app parecería "sin red".
 *  2. En nativo se rechaza localhost/127.0.0.1. Usar la IP LAN del equipo
 *     (p. ej. http://192.168.1.20:8000/api) o 10.0.2.2 en el emulador
 *     Android. En web sí se permite para desarrollo local.
 *  3. La URL debe apuntar a la base del gateway y terminar en /api.
 *  4. En producción (NODE_ENV=production) sólo se acepta https.
 *  5. Sin credenciales embebidas (usuario:clave@host): esos datos no van en
 *     una variable EXPO_PUBLIC_*, que queda escrita en el bundle.
 */
const HOSTS_DEL_TELEFONO = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

export type OpcionesResolver = {
  plataforma?: string;
  produccion?: boolean;
};

export function resolverUrlApi(
  valor: string | undefined = process.env.EXPO_PUBLIC_API_URL,
  { plataforma = Platform.OS, produccion = process.env.NODE_ENV === 'production' }: OpcionesResolver = {},
): string {
  const crudo = (valor ?? '').trim();
  if (!crudo) {
    throw new Error(
      'Falta EXPO_PUBLIC_API_URL. Copia frontend/movil/.env.example a .env y ' +
        'pon la URL del gateway (por ejemplo http://192.168.1.20:8000/api).',
    );
  }

  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    throw new Error(
      `EXPO_PUBLIC_API_URL no es una URL válida: "${crudo}". ` +
        'Debe incluir el esquema, el host, el puerto y /api.',
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL debe usar http:// o https://.');
  }
  if (url.username || url.password) {
    throw new Error(
      'EXPO_PUBLIC_API_URL no puede incluir usuario o contraseña: ' +
        'EXPO_PUBLIC_* se publica en el bundle de la app.',
    );
  }
  if (url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_API_URL no admite query string ni fragmento.');
  }

  const host = url.hostname.toLowerCase();
  if (plataforma !== 'web' && HOSTS_DEL_TELEFONO.has(host)) {
    throw new Error(
      `"${host}" en un teléfono apunta al propio teléfono, no a tu equipo. ` +
        'Usa la IP LAN del backend (ej. http://192.168.1.20:8000/api) o ' +
        'http://10.0.2.2:8000/api en el emulador Android.',
    );
  }

  if (produccion && url.protocol !== 'https:') {
    throw new Error(
      'En producción la app sólo habla con el backend por https. ' +
        'Configura EXPO_PUBLIC_API_URL con https://.',
    );
  }

  const ruta = url.pathname.replace(/\/+$/, '');
  if (ruta !== '/api') {
    throw new Error(
      'EXPO_PUBLIC_API_URL debe terminar en /api (la base del gateway), ' +
        `no en "${url.pathname}".`,
    );
  }

  return `${url.protocol}//${url.host}/api`;
}

/** true si el valor parece una URL aceptable para esta plataforma. */
export function urlApiValida(valor?: string, opciones?: OpcionesResolver): boolean {
  try {
    resolverUrlApi(valor, opciones);
    return true;
  } catch {
    return false;
  }
}
