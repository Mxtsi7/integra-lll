import { beforeEach, expect, it, vi } from 'vitest';
import { configurarApi } from './cliente';
import { getCatalogosSuscripciones, getPaises } from './catalogos';

beforeEach(() => {
  configurarApi({ urlBase: 'https://ejemplo.test/api' });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }));
});

it('consulta catálogos históricos y países con el cliente compartido', async () => {
  await getCatalogosSuscripciones();
  expect(fetch).toHaveBeenLastCalledWith('https://ejemplo.test/api/catalogos/suscripciones/?incluir_inactivos=true', expect.anything());
  await getPaises();
  expect(fetch).toHaveBeenLastCalledWith('https://ejemplo.test/api/catalogos/paises/?incluir_inactivos=false', expect.anything());
});
