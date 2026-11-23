import type { CuentaConectada } from '../tipos';
import { pedir, type Paginado } from './cliente';
import type { ProveedorCorreo } from './conectores';

/** El backend permite hasta 100 por página (`max_page_size` de connectors). */
const CUENTAS_POR_PAGINA = 100;
/** Tope de seguridad: 10 páginas son 1000 cuentas, muchísimas más de las que tiene una organización. */
const MAX_PAGINAS_CUENTAS = 10;

/**
 * GET /api/conectores/ (FE-02). Devuelve las cuentas de todas las páginas.
 * No sigue el `next` de la respuesta porque trae el host interno del servicio;
 * se pide cada página por número y `next` solo avisa si queda otra.
 */
export async function getCuentasConectadas(): Promise<CuentaConectada[]> {
  const cuentas: CuentaConectada[] = [];

  for (let pagina = 1; pagina <= MAX_PAGINAS_CUENTAS; pagina += 1) {
    const respuesta = await pedir<Paginado<CuentaConectada>>(
      `/conectores/?page=${pagina}&page_size=${CUENTAS_POR_PAGINA}`,
    );
    cuentas.push(...respuesta.results);
    if (!respuesta.next) return cuentas;
  }

  throw new RangeError('No pudimos cargar todas las cuentas conectadas.');
}

/** Respuesta de FE-03. */
export interface AutorizacionIniciada {
  url_autorizacion: string;
  /** Identifica este intento; el callback lo devuelve para cerrar el flujo. */
  estado_oauth: string;
  expira_en: string;
}

/**
 * POST /api/conectores/autorizaciones/ (FE-03). No crea ninguna cuenta: solo prepara
 * el enlace. La cuenta nace cuando el callback (FE-04) recibe el código del proveedor.
 * `retorno` debe estar en la lista permitida del backend (OAUTH_RETORNOS_PERMITIDOS).
 */
export async function iniciarAutorizacionCorreo(
  proveedor: ProveedorCorreo,
  retorno?: string,
): Promise<AutorizacionIniciada> {
  const cuerpo = retorno ? { proveedor, retorno } : { proveedor };
  return await pedir('/conectores/autorizaciones/', { method: 'POST', body: cuerpo });
}

/**
 * DELETE /api/conectores/<id>/ (FE-05). Desconecta y revoca el acceso, pero no borra
 * la cuenta: responde 200 con la cuenta en su estado nuevo, para no tener que pedir la lista otra vez.
 */
export async function desconectarCuenta(id: string): Promise<CuentaConectada> {
  return await pedir(`/conectores/${encodeURIComponent(id)}/`, { method: 'DELETE' });
}
// Añadir al final de frontend/shared/src/api/cuentas.ts

export interface EntradaCallbackOAuth {
  estado_oauth: string;
  codigo?: string;
  error?: string;
}

export type ResultadoCallbackOAuth =
  | { tipo: 'conectada'; cuenta: CuentaConectada }
  | { tipo: 'cancelada'; proveedor: ProveedorCorreo; detalle: string };

const PATRON_ESTADO_OAUTH = /^[A-Za-z0-9_-]{8,64}$/;
const PATRON_ERROR_OAUTH = /^[A-Za-z0-9_.-]{1,120}$/;

/** Valida localmente los parámetros del retorno antes de llamar al backend. */
export function esEntradaCallbackValida(entrada: EntradaCallbackOAuth): boolean {
  if (!PATRON_ESTADO_OAUTH.test(entrada.estado_oauth)) return false;

  const tieneCodigo = typeof entrada.codigo === 'string' && entrada.codigo.trim().length > 0;
  const tieneError = typeof entrada.error === 'string' && entrada.error.trim().length > 0;

  if (tieneCodigo === tieneError) return false;
  if (tieneCodigo && /\s/.test(entrada.codigo!)) return false;
  if (tieneError && !PATRON_ERROR_OAUTH.test(entrada.error!)) return false;

  return true;
}

/**
 * POST /api/conectores/autorizaciones/callback/ (FE-04 / AN-16).
 * Reenvía el `state` y el `code` (o `error` si canceló) usando la sesión activa.
 */
export async function procesarCallbackOAuth(
  entrada: EntradaCallbackOAuth,
): Promise<ResultadoCallbackOAuth> {
  if (!esEntradaCallbackValida(entrada)) {
    throw new Error('Los parámetros de autorización no son válidos.');
  }

  const cuerpo: Record<string, string> = { estado_oauth: entrada.estado_oauth };
  if (entrada.codigo) cuerpo.codigo = entrada.codigo;
  if (entrada.error) cuerpo.error = entrada.error;

  const respuesta = await pedir<
    CuentaConectada | { resultado: 'cancelada'; proveedor: ProveedorCorreo; detalle?: string }
  >('/conectores/autorizaciones/callback/', {
    method: 'POST',
    body: cuerpo,
  });

  if ('resultado' in respuesta && respuesta.resultado === 'cancelada') {
    return {
      tipo: 'cancelada',
      proveedor: respuesta.proveedor,
      detalle: respuesta.detalle ?? 'Autorización cancelada.',
    };
  }

  return {
    tipo: 'conectada',
    cuenta: respuesta as CuentaConectada,
  };
}
