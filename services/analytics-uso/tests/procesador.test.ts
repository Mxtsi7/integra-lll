import { describe, expect, it } from 'vitest';

import { ProcesadorUso } from '../src/aplicacion/procesador-uso';
import type {
  RepositorioUso,
  ResultadoRegistroUso,
} from '../src/aplicacion/repositorio-uso';
import { ErrorConflictoEvento, ErrorValidacionUso } from '../src/dominio/errores';
import type { EventoUsoNormalizado } from '../src/dominio/uso-recolectores.dto';
import { eventoBase } from './fixtures';

class RepositorioFalso implements RepositorioUso {
  readonly llamadas: EventoUsoNormalizado[] = [];

  constructor(
    private readonly resultado: ResultadoRegistroUso = 'aplicado',
    private readonly error?: Error,
  ) {}

  async registrar(evento: EventoUsoNormalizado): Promise<ResultadoRegistroUso> {
    this.llamadas.push(evento);
    if (this.error) throw this.error;
    return this.resultado;
  }
}

describe('ProcesadorUso', () => {
  it('valida, normaliza y delega el evento al repositorio', async () => {
    const repositorio = new RepositorioFalso();
    const procesador = new ProcesadorUso(repositorio);

    const resultado = await procesador.procesar(eventoBase());

    expect(resultado).toBe('aplicado');
    expect(repositorio.llamadas).toHaveLength(1);
    const evento = repositorio.llamadas[0]!;
    expect(evento.eventId).toBe('22222222-2222-4222-8222-222222222222');
    expect(evento.fechaLocal).toBe('2026-11-09');
    expect(evento.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('propaga el resultado duplicado sin efectos adicionales', async () => {
    const repositorio = new RepositorioFalso('duplicado');
    const procesador = new ProcesadorUso(repositorio);

    await expect(procesador.procesar(eventoBase())).resolves.toBe('duplicado');
  });

  it('propaga el resultado ignorado de un tenant eliminado', async () => {
    const repositorio = new RepositorioFalso('ignorado');
    const procesador = new ProcesadorUso(repositorio);

    await expect(procesador.procesar(eventoBase())).resolves.toBe('ignorado');
  });

  it('no llama al repositorio si el mensaje es inválido', async () => {
    const repositorio = new RepositorioFalso();
    const procesador = new ProcesadorUso(repositorio);

    await expect(
      procesador.procesar({ ...eventoBase(), evento: 'otro.evento' }),
    ).rejects.toBeInstanceOf(ErrorValidacionUso);
    expect(repositorio.llamadas).toHaveLength(0);
  });

  it('propaga el conflicto de event_id para que el consumidor lo rechace', async () => {
    const repositorio = new RepositorioFalso(
      'aplicado',
      new ErrorConflictoEvento('conflicto'),
    );
    const procesador = new ProcesadorUso(repositorio);

    await expect(procesador.procesar(eventoBase())).rejects.toBeInstanceOf(
      ErrorConflictoEvento,
    );
  });
});
