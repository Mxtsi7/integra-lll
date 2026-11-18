import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import { consultarAsistente } from './asistente';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

describe('consultarAsistente (S3-CH-15, VI-22)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset();
  });

  it('manda POST /asistente/ con la pregunta en "mensaje" y devuelve la respuesta tal cual', async () => {
    const respuesta = { estado: 'ok', motivo: null, respuesta: 'Revisa el streaming.' };
    vi.mocked(pedir).mockResolvedValue(respuesta);

    await expect(consultarAsistente('¿Qué reviso primero?')).resolves.toEqual(respuesta);
    expect(pedir).toHaveBeenCalledWith('/asistente/', { method: 'POST', body: { mensaje: '¿Qué reviso primero?' } });
  });

  it('devuelve la respuesta de respaldo con su motivo, sin tratarla como error', async () => {
    const respaldo = { estado: 'degradado', motivo: 'timeout', respuesta: 'Registramos 120 minutos de uso.' };
    vi.mocked(pedir).mockResolvedValue(respaldo);

    await expect(consultarAsistente('Resumen')).resolves.toEqual(respaldo);
  });

  it('propaga el error de la API sin tragárselo', async () => {
    vi.mocked(pedir).mockRejectedValue(new Error('boom'));
    await expect(consultarAsistente('Hola')).rejects.toThrow('boom');
  });
});
