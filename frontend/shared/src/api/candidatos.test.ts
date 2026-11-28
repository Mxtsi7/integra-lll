import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, pedir } from './cliente';
import {
  codigoDeConfirmacionRechazada,
  codigoDeRechazoNoPermitido,
  confirmarCandidato,
  getCandidatos,
  rechazarCandidato,
  TAMANO_PAGINA_CANDIDATOS,
} from './candidatos';

// Solo se simula pedir: ErrorDeApi es el real, porque los códigos de 409 se reconocen con instanceof.
vi.mock('./cliente', async (importarOriginal) => ({ ...(await importarOriginal<typeof import('./cliente')>()), pedir: vi.fn() }));

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

describe('confirmar un candidato (S3-CH-08, S3-FE-15)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({ id: 'c-1', estado: 'confirmado' });
  });

  it('es un POST sin cuerpo a /candidatos/<id>/confirmar/', async () => {
    await confirmarCandidato('c-1');

    expect(pedir).toHaveBeenCalledWith('/candidatos/c-1/confirmar/', { method: 'POST' });
  });

  it('codifica el id para que no cambie la ruta', async () => {
    await confirmarCandidato('a/b?c');

    expect(pedir).toHaveBeenCalledWith('/candidatos/a%2Fb%3Fc/confirmar/', { method: 'POST' });
  });

  it('devuelve el candidato tal cual lo mandó el servidor', async () => {
    const confirmado = { id: 'c-1', estado: 'confirmado', aplicacion: 'por_enviar' };
    vi.mocked(pedir).mockResolvedValue(confirmado);

    await expect(confirmarCandidato('c-1')).resolves.toEqual(confirmado);
  });

  it('no atrapa los errores: quien llama decide qué decir de cada uno', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Error interno.', 500));

    await expect(confirmarCandidato('c-1')).rejects.toBeInstanceOf(ErrorDeApi);
  });
});

describe('rechazar un candidato (S3-CH-09, S3-FE-16)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset().mockResolvedValue({ id: 'c-1', estado: 'rechazado' });
  });

  it('es un POST sin cuerpo a /candidatos/<id>/rechazar/', async () => {
    await rechazarCandidato('c-1');

    expect(pedir).toHaveBeenCalledWith('/candidatos/c-1/rechazar/', { method: 'POST' });
  });

  it('codifica el id para que no cambie la ruta', async () => {
    await rechazarCandidato('a/b?c');

    expect(pedir).toHaveBeenCalledWith('/candidatos/a%2Fb%3Fc/rechazar/', { method: 'POST' });
  });

  it('devuelve el candidato tal cual lo mandó el servidor', async () => {
    const rechazado = { id: 'c-1', estado: 'rechazado', aplicacion: null };
    vi.mocked(pedir).mockResolvedValue(rechazado);

    await expect(rechazarCandidato('c-1')).resolves.toEqual(rechazado);
  });

  it('no atrapa los errores: quien llama decide qué decir de cada uno', async () => {
    vi.mocked(pedir).mockRejectedValue(new ErrorDeApi('Error interno.', 500));

    await expect(rechazarCandidato('c-1')).rejects.toBeInstanceOf(ErrorDeApi);
  });
});

describe('el código de un 409 al confirmar (S3-CH-08)', () => {
  it.each(['candidato_rechazado', 'servicio_sin_resolver', 'tipo_sin_regla'] as const)('reconoce %s', (codigo) => {
    const error = new ErrorDeApi('Texto del servidor.', 409, { codigo: [codigo] });

    expect(codigoDeConfirmacionRechazada(error)).toBe(codigo);
  });

  it('un 409 con un código que no conoce da null: no inventa un motivo', () => {
    expect(codigoDeConfirmacionRechazada(new ErrorDeApi('Otro.', 409, { codigo: ['codigo_nuevo'] }))).toBeNull();
  });

  it('un 409 sin código da null', () => {
    expect(codigoDeConfirmacionRechazada(new ErrorDeApi('Conflicto.', 409))).toBeNull();
  });

  it('el mismo código con otro estado HTTP no cuenta', () => {
    expect(codigoDeConfirmacionRechazada(new ErrorDeApi('x', 400, { codigo: ['candidato_rechazado'] }))).toBeNull();
  });

  it('un código de rechazar no se confunde con uno de confirmar', () => {
    expect(codigoDeConfirmacionRechazada(new ErrorDeApi('x', 409, { codigo: ['candidato_ya_confirmado'] }))).toBeNull();
  });

  it.each([new TypeError('Failed to fetch'), new Error('x'), null, undefined, 'candidato_rechazado'])(
    'algo que no es un error de la API da null (%s)',
    (error) => {
      expect(codigoDeConfirmacionRechazada(error)).toBeNull();
    },
  );
});

describe('el código de un 409 al rechazar (S3-CH-09)', () => {
  it('reconoce candidato_ya_confirmado', () => {
    const error = new ErrorDeApi('Ese cobro ya está confirmado.', 409, { codigo: ['candidato_ya_confirmado'] });

    expect(codigoDeRechazoNoPermitido(error)).toBe('candidato_ya_confirmado');
  });

  it('un 409 con un código que no conoce da null: no inventa un motivo', () => {
    expect(codigoDeRechazoNoPermitido(new ErrorDeApi('Otro.', 409, { codigo: ['codigo_nuevo'] }))).toBeNull();
  });

  it('un código de confirmar no se confunde con el de rechazar', () => {
    expect(codigoDeRechazoNoPermitido(new ErrorDeApi('x', 409, { codigo: ['candidato_rechazado'] }))).toBeNull();
  });

  it('el mismo código con otro estado HTTP no cuenta', () => {
    expect(codigoDeRechazoNoPermitido(new ErrorDeApi('x', 400, { codigo: ['candidato_ya_confirmado'] }))).toBeNull();
  });

  it.each([new TypeError('Failed to fetch'), new Error('x'), null, undefined, 'candidato_ya_confirmado'])(
    'algo que no es un error de la API da null (%s)',
    (error) => {
      expect(codigoDeRechazoNoPermitido(error)).toBeNull();
    },
  );
});
