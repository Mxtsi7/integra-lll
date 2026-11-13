import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { desconectarCuenta, getCuentasConectadas, iniciarAutorizacionCorreo } from './cuentas';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('cuentas conectadas (FE-02, FE-03)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset();
  });

  it('junta las cuentas de todas las páginas', async () => {
    vi.mocked(pedir)
      .mockResolvedValueOnce({ count: 2, next: 'http://interno/?page=2', previous: null, results: [{ id: 'c1' }] })
      .mockResolvedValueOnce({ count: 2, next: null, previous: null, results: [{ id: 'c2' }] });
    const cuentas = await getCuentasConectadas();
    expect(cuentas.map((cuenta) => cuenta.id)).toEqual(['c1', 'c2']);
    expect(pedir).toHaveBeenNthCalledWith(1, '/conectores/?page=1&page_size=100');
    expect(pedir).toHaveBeenNthCalledWith(2, '/conectores/?page=2&page_size=100');
  });

  it('si el backend nunca termina de paginar, falla en vez de repetir sin fin', async () => {
    vi.mocked(pedir).mockResolvedValue({ count: 1, next: 'siguiente', previous: null, results: [] });
    await expect(getCuentasConectadas()).rejects.toThrow(RangeError);
    expect(pedir).toHaveBeenCalledTimes(10);
  });

  it('iniciar la autorización manda solo el proveedor si no hay retorno', async () => {
    await iniciarAutorizacionCorreo('gmail');
    expect(pedir).toHaveBeenCalledWith('/conectores/autorizaciones/', { method: 'POST', body: { proveedor: 'gmail' } });
  });

  it('con retorno lo incluye en el cuerpo', async () => {
    await iniciarAutorizacionCorreo('outlook', 'https://app.ojoalgasto.cl/retorno');
    expect(pedir).toHaveBeenCalledWith('/conectores/autorizaciones/', {
      method: 'POST',
      body: { proveedor: 'outlook', retorno: 'https://app.ojoalgasto.cl/retorno' },
    });
  });

  it('desconectar es un DELETE con el id codificado', async () => {
    await desconectarCuenta('c/1');
    expect(pedir).toHaveBeenCalledWith('/conectores/c%2F1/', { method: 'DELETE' });
  });
});
