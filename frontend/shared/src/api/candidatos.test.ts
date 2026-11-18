import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { getCandidatos, TAMANO_PAGINA_CANDIDATOS } from './candidatos';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('candidatos (S3-CH-04, S3-FE-14)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({ count: 0, next: null, previous: null, results: [] });
  });

  it('pide la página y su tamaño, y sin filtros no manda ninguno', async () => {
    await getCandidatos();
    expect(pedir).toHaveBeenCalledWith(`/candidatos/?page=1&page_size=${TAMANO_PAGINA_CANDIDATOS}`);
  });

  it('manda cada filtro solo cuando tiene valor, con la página pedida', async () => {
    await getCandidatos({ origen: 'correo', estado: 'propuesto', pagina: 3 });
    expect(pedir).toHaveBeenCalledWith(
      `/candidatos/?page=3&page_size=${TAMANO_PAGINA_CANDIDATOS}&origen=correo&estado=propuesto`,
    );
  });

  it('el filtro por importación viaja como está: el servidor valida el UUID', async () => {
    const importacion = '6f1c2b8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f';
    await getCandidatos({ importacion });
    expect(pedir).toHaveBeenCalledWith(
      `/candidatos/?page=1&page_size=${TAMANO_PAGINA_CANDIDATOS}&importacion=${importacion}`,
    );
  });

  it('devuelve la página tal cual la mandó el servidor', async () => {
    const pagina = { count: 1, next: null, previous: null, results: [{ id: 'c-1' }] };
    vi.mocked(pedir).mockResolvedValue(pagina);
    await expect(getCandidatos()).resolves.toEqual(pagina);
  });
});
