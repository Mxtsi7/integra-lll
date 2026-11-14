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
