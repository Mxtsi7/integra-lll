import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { getImportacion, getMisImportaciones } from './importaciones';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('importaciones (CH-27, FE-08)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({});
  });

  it('una importación con GET /importaciones/<id>/, con el id codificado', async () => {
    await getImportacion('imp-1');
    expect(pedir).toHaveBeenCalledWith('/importaciones/imp-1/');
    await getImportacion('a/b?c');
    expect(pedir).toHaveBeenLastCalledWith('/importaciones/a%2Fb%3Fc/');
  });

  it('las propias con ?mias=true y la página pedida', async () => {
    await getMisImportaciones();
    expect(pedir).toHaveBeenCalledWith('/importaciones/?mias=true&page=1');
    await getMisImportaciones(3);
    expect(pedir).toHaveBeenLastCalledWith('/importaciones/?mias=true&page=3');
  });
});
