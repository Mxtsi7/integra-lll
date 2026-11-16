import { describe, expect, it } from 'vitest';

import { ProcesadorSuscripcion } from '../src/aplicacion/procesador-suscripcion';
import type {
  RepositorioSuscripcion,
  ResultadoProyeccionSuscripcion,
} from '../src/aplicacion/repositorio-suscripcion';
import {
  decidirAccionSuscripcion,
} from '../src/consumidor/suscripcion.consumer';
import {
  ErrorConflictoSuscripcion,
  ErrorValidacionSuscripcion,
} from '../src/dominio/errores';
import type { EventoSuscripcionEstadoNormalizado } from '../src/dominio/suscripcion-estado.dto';
import { validarYNormalizarSuscripcion } from '../src/dominio/validacion-suscripcion';

export const ORGANIZACION = '11111111-1111-4111-8111-111111111111';
export const SUSCRIPCION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const EVENTO = '22222222-2222-4222-8222-222222222222';
export const CORRELACION = '4b8e77a2-1c3d-4e5f-8a9b-0c1d2e3f4a5b';

export function eventoEstadoBase(
  overrides: {
    readonly evento?: Record<string, unknown>;
    readonly datos?: Record<string, unknown>;
  } = {},
): Record<string, unknown> {
  return {
    evento: 'suscripcion.estado_cambiado',
    version: 2,
    id: EVENTO,
    ocurrido_en: '2026-11-09T12:02:01.123Z',
    correlation_id: CORRELACION,
    organizacion_id: ORGANIZACION,
    datos: {
      suscripcion_id: SUSCRIPCION,
      proveedor_id: null,
      nombre: 'Netflix',
      monto: '9990.00',
      moneda: 'CLP',
      ciclo: 'mensual',
      proximo_cobro: '2026-12-01',
      estado: 'activo',
      fin_prueba: null,
      estado_anterior: 'prueba',
      evento_estado: 'fin_prueba',
      ...overrides.datos,
    },
    ...overrides.evento,
  };
}

class RepositorioFalso implements RepositorioSuscripcion {
  readonly llamadas: EventoSuscripcionEstadoNormalizado[] = [];

  constructor(
    private readonly resultado: ResultadoProyeccionSuscripcion = 'aplicado',
    private readonly error?: Error,
  ) {}

  async registrar(
    evento: EventoSuscripcionEstadoNormalizado,
  ): Promise<ResultadoProyeccionSuscripcion> {
    this.llamadas.push(evento);
    if (this.error) throw this.error;
    return this.resultado;
  }
}

describe('validación de suscripcion.estado_cambiado.v2', () => {
  it('normaliza el snapshot y conserva el monto como texto decimal', () => {
    const evento = validarYNormalizarSuscripcion(eventoEstadoBase());

    expect(evento.organizacionId).toBe(ORGANIZACION);
    expect(evento.suscripcionId).toBe(SUSCRIPCION);
    expect(evento.monto).toBe('9990.00');
    expect(evento.moneda).toBe('CLP');
    expect(evento.estado).toBe('activo');
    expect(evento.estadoAnterior).toBe('prueba');
    expect(evento.eventoEstado).toBe('fin_prueba');
    expect(evento.finPrueba).toBeNull();
    expect(evento.ocurridoEn.toISOString()).toBe('2026-11-09T12:02:01.123Z');
    expect(evento.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produce la misma huella aunque cambie el orden de las claves', () => {
    const normal = validarYNormalizarSuscripcion(eventoEstadoBase());
    const base = eventoEstadoBase();
    const datos = base.datos as Record<string, unknown>;
    const desordenado = {
      datos: Object.fromEntries(Object.entries(datos).reverse()),
      organizacion_id: base.organizacion_id,
      correlation_id: base.correlation_id,
      ocurrido_en: base.ocurrido_en,
      id: base.id,
      version: base.version,
      evento: base.evento,
    };

    expect(validarYNormalizarSuscripcion(desordenado).huella).toBe(normal.huella);
  });

  it.each([
    ['un decimal', '9990.0'],
    ['cero con decimales', '0.00'],
    ['con ceros a la izquierda', '09990.00'],
    ['más de 8 dígitos enteros', '123456789.00'],
  ])('rechaza el monto %s', (_caso, monto) => {
    expect(() =>
      validarYNormalizarSuscripcion(eventoEstadoBase({ datos: { monto } })),
    ).toThrow(ErrorValidacionSuscripcion);
  });

  it('rechaza una fecha de calendario inexistente', () => {
    expect(() =>
      validarYNormalizarSuscripcion(
        eventoEstadoBase({ datos: { proximo_cobro: '2026-02-30' } }),
      ),
    ).toThrow(ErrorValidacionSuscripcion);
  });

  it('rechaza más de tres decimales en ocurrido_en', () => {
    expect(() =>
      validarYNormalizarSuscripcion(
        eventoEstadoBase({
          evento: { ocurrido_en: '2026-11-09T12:02:01.123456Z' },
        }),
      ),
    ).toThrow(ErrorValidacionSuscripcion);
  });

  it('exige la transición que justifica el hecho', () => {
    const sinEstadoAnterior = eventoEstadoBase();
    delete (sinEstadoAnterior.datos as Record<string, unknown>).estado_anterior;

    expect(() => validarYNormalizarSuscripcion(sinEstadoAnterior)).toThrow(
      ErrorValidacionSuscripcion,
    );
  });

  it('rechaza monedas que no sean un código ISO de tres letras', () => {
    expect(() =>
      validarYNormalizarSuscripcion(
        eventoEstadoBase({ datos: { moneda: 'clp' } }),
      ),
    ).toThrow(ErrorValidacionSuscripcion);
  });
});

describe('ProcesadorSuscripcion', () => {
  it('valida y delega en el repositorio el hecho normalizado', async () => {
    const repositorio = new RepositorioFalso();
    const procesador = new ProcesadorSuscripcion(repositorio);

    const resultado = await procesador.procesar(eventoEstadoBase());

    expect(resultado).toBe('aplicado');
    expect(repositorio.llamadas).toHaveLength(1);
    expect(repositorio.llamadas[0]?.suscripcionId).toBe(SUSCRIPCION);
    expect(repositorio.llamadas[0]?.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('no llama al repositorio con un evento inválido', async () => {
    const repositorio = new RepositorioFalso();
    const procesador = new ProcesadorSuscripcion(repositorio);

    await expect(
      procesador.procesar(eventoEstadoBase({ evento: { version: 1 } })),
    ).rejects.toBeInstanceOf(ErrorValidacionSuscripcion);
    expect(repositorio.llamadas).toHaveLength(0);
  });

  it('propaga duplicado, obsoleto e ignorado sin efectos extra', async () => {
    for (const resultado of ['duplicado', 'obsoleto', 'ignorado'] as const) {
      const procesador = new ProcesadorSuscripcion(
        new RepositorioFalso(resultado),
      );
      await expect(procesador.procesar(eventoEstadoBase())).resolves.toBe(
        resultado,
      );
    }
  });

  it('propaga el conflicto para que el consumidor lo rechace', async () => {
    const procesador = new ProcesadorSuscripcion(
      new RepositorioFalso(
        'aplicado',
        new ErrorConflictoSuscripcion('conflicto'),
      ),
    );

    await expect(procesador.procesar(eventoEstadoBase())).rejects.toBeInstanceOf(
      ErrorConflictoSuscripcion,
    );
  });
});

describe('decisión ante un mensaje de suscripción fallido', () => {
  it('rechaza sin reintento los errores de contrato', () => {
    expect(
      decidirAccionSuscripcion(
        new ErrorValidacionSuscripcion('evento_invalido', 'x'),
      ),
    ).toBe('rechazar');
    expect(
      decidirAccionSuscripcion(new ErrorConflictoSuscripcion('x')),
    ).toBe('rechazar');
  });

  it('reintenta los fallos transitorios y no confunde otros errores', () => {
    expect(decidirAccionSuscripcion(new Error('base caída'))).toBe('reintentar');
    expect(decidirAccionSuscripcion({ code: 'ECONNREFUSED' })).toBe(
      'reintentar',
    );
  });
});
