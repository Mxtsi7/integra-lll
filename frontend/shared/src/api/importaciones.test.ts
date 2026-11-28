import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { getImportacion, getLecturasDeCorreo, getMisImportaciones, subirArchivoImportacion } from './importaciones';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('importaciones (CH-27, FE-08, S3-SE-02, FE-07)', () => {
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

  it('las lecturas de correo con ?origen=correo y sin mias: las programadas no las pidió una persona', async () => {
    await getLecturasDeCorreo();
    expect(pedir).toHaveBeenCalledWith('/importaciones/?origen=correo&page=1');
    await getLecturasDeCorreo(3);
    expect(pedir).toHaveBeenLastCalledWith('/importaciones/?origen=correo&page=3');
  });

  it('subirArchivoImportacion envía POST multipart con el campo archivo', async () => {
    const fakeBlob = new Blob(['col1,col2\n1,2'], { type: 'text/csv' });
    await subirArchivoImportacion(fakeBlob, 'movimientos.csv');

    expect(pedir).toHaveBeenCalledTimes(1);
    const [path, opciones] = vi.mocked(pedir).mock.calls[0];
    expect(path).toBe('/importaciones/archivos/');
    expect(opciones?.method).toBe('POST');
    expect(opciones?.body).toBeInstanceOf(FormData);

    const formData = opciones?.body as FormData;
    expect(formData.get('archivo')).toBeDefined();
  });
});
