import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from './cliente';
import { obtenerHistorialAccesos } from './historialAccesos';

vi.mock('./cliente', async (original) => ({
  ...(await original<typeof import('./cliente')>()),
  pedir: vi.fn(),
}));

const pedirMock = vi.mocked(pedir);

describe('obtenerHistorialAccesos (S3-AN-06)', () => {
  beforeEach(() => pedirMock.mockReset());

  it('pide la primera página con límite 20 y offset 0 y convierte los nombres', async () => {
    pedirMock.mockResolvedValue({
      resultados: [{ iniciada_en: '2026-11-23T18:00:00Z', metodo: 'google' }],
      siguiente_offset: null,
    });
    const pagina = await obtenerHistorialAccesos();
    expect(pedirMock).toHaveBeenCalledWith('/usuarios/me/historial-accesos/?limit=20&offset=0', { signal: undefined });
    expect(pagina).toEqual({
      accesos: [{ iniciadaEn: '2026-11-23T18:00:00Z', metodo: 'google' }],
      siguienteOffset: null,
    });
  });

  it('usa el offset pedido y devuelve siguiente_offset', async () => {
    pedirMock.mockResolvedValue({ resultados: [], siguiente_offset: 40 });
    const pagina = await obtenerHistorialAccesos({ offset: 20 });
    expect(pedirMock.mock.calls[0][0]).toBe('/usuarios/me/historial-accesos/?limit=20&offset=20');
    expect(pagina.siguienteOffset).toBe(40);
  });

  it.each([
    ['sin resultados', { siguiente_offset: null }],
    ['un acceso sin método válido', { resultados: [{ iniciada_en: 'x', metodo: 'otro' }], siguiente_offset: null }],
    ['siguiente_offset inválido', { resultados: [], siguiente_offset: -1 }],
    ['cuerpo vacío', undefined],
  ])('una respuesta con otra forma (%s) es un error, no "sin accesos"', async (_nombre, cuerpo) => {
    pedirMock.mockResolvedValue(cuerpo);
    const error = (await obtenerHistorialAccesos().catch((e: unknown) => e)) as ErrorDeApi;
    expect(error).toBeInstanceOf(ErrorDeApi);
    expect(error.status).toBe(502);
  });

  it('propaga los errores del servicio', async () => {
    pedirMock.mockRejectedValueOnce(new ErrorDeApi('no', 403));
    const error = (await obtenerHistorialAccesos().catch((e: unknown) => e)) as ErrorDeApi;
    expect(error.status).toBe(403);
  });
});
