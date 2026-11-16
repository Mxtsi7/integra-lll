import { describe, expect, it } from 'vitest';

import { ErrorValidacionUso } from '../src/dominio/errores';
import {
  validarPayloadUso,
  validarYNormalizar,
} from '../src/dominio/validacion';
import { DATOS_BASE, eventoBase } from './fixtures';

function codigo(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorValidacionUso) return error.codigo;
    throw error;
  }
  throw new Error('se esperaba ErrorValidacionUso');
}

function datosInvalidos(cambios: Record<string, unknown>) {
  const datos = { ...DATOS_BASE, ...cambios };
  return {
    ...eventoBase(),
    id: datos.event_id,
    datos,
  };
}

describe('fixtures válidas del contrato v1', () => {
  it('normaliza la fixture Android', () => {
    const evento = validarYNormalizar(eventoBase());
    expect(evento.fechaLocal).toBe('2026-11-09');
    expect(evento.duracionMs).toBe(30_000);
    expect(evento.tramos).toHaveLength(1);
    expect(evento.tramos[0]?.inicio).toBeInstanceOf(Date);
    expect(evento.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('acepta cero observado de un navegador', () => {
    const evento = validarYNormalizar(
      eventoBase({
        datos: {
          event_id: '44444444-4444-4444-8444-444444444444',
          recolector_id: '55555555-5555-4555-8555-555555555555',
          origen: 'navegador',
          duracion_ms: 0,
          tramos_actividad: [],
        },
      }),
    );
    expect(evento.duracionMs).toBe(0);
  });

  it('acepta la medianoche local con fin en el límite semiabierto', () => {
    const evento = validarYNormalizar(
      eventoBase({
        datos: {
          event_id: '66666666-6666-4666-8666-666666666666',
          recolector_id: '77777777-7777-4777-8777-777777777777',
          inicio: '2026-11-09T03:00:00Z',
          fin: '2026-11-10T03:00:00Z',
          duracion_ms: 30_000,
          tramos_actividad: [
            {
              inicio: '2026-11-10T02:59:30Z',
              fin: '2026-11-10T03:00:00Z',
            },
          ],
          cobertura: 'parcial',
        },
      }),
    );
    expect(evento.fechaLocal).toBe('2026-11-09');
  });

  it('acepta 30 s + 30 s y conserva 60 s exactos', () => {
    const evento = validarYNormalizar(
      eventoBase({
        datos: {
          event_id: '88888888-8888-4888-8888-888888888888',
          recolector_id: '99999999-9999-4999-8999-999999999999',
          duracion_ms: 60_000,
          tramos_actividad: [
            { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:00:30Z' },
            { inicio: '2026-11-09T12:01:00Z', fin: '2026-11-09T12:01:30Z' },
          ],
          cobertura: 'parcial',
        },
      }),
    );
    expect(evento.duracionMs).toBe(60_000);
  });

  it('acepta una pausa conocida sin medir', () => {
    const evento = validarYNormalizar(
      eventoBase({
        datos: {
          event_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          recolector_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          origen: 'navegador',
          duracion_ms: 0,
          tramos_actividad: [],
          cobertura: 'sin_medicion',
          estado: 'pausado',
        },
      }),
    );
    expect(evento.estado).toBe('pausado');
  });
});

describe('reglas semánticas', () => {
  it('rechaza duración distinta de la suma de tramos', () => {
    expect(
      codigo(() =>
        validarYNormalizar(datosInvalidos({ duracion_ms: 60_000 })),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza un tramo fuera de la ventana', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({
            duracion_ms: 30_000,
            tramos_actividad: [
              {
                inicio: '2026-11-09T11:59:50Z',
                fin: '2026-11-09T12:00:20Z',
              },
            ],
          }),
        ),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza tramos solapados entre sí', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({
            duracion_ms: 70_000,
            tramos_actividad: [
              { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:00:40Z' },
              { inicio: '2026-11-09T12:00:20Z', fin: '2026-11-09T12:00:50Z' },
            ],
          }),
        ),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza tramos desordenados', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({
            duracion_ms: 60_000,
            tramos_actividad: [
              { inicio: '2026-11-09T12:01:00Z', fin: '2026-11-09T12:01:30Z' },
              { inicio: '2026-11-09T12:00:00Z', fin: '2026-11-09T12:00:30Z' },
            ],
          }),
        ),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza actividad positiva con estado no activo', () => {
    expect(
      codigo(() =>
        validarYNormalizar(datosInvalidos({ estado: 'pausado' })),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza actividad positiva con cobertura sin_medicion', () => {
    expect(
      codigo(() =>
        validarYNormalizar(datosInvalidos({ cobertura: 'sin_medicion' })),
      ),
    ).toBe('detalle_actividad_invalido');
  });

  it('rechaza una zona IANA inexistente', () => {
    expect(
      codigo(() =>
        validarYNormalizar(datosInvalidos({ zona_horaria: 'Marte/Olympus' })),
      ),
    ).toBe('evento_invalido');
  });

  it('rechaza una ventana que cruza el día local', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({
            event_id: '99998888-7777-4666-8555-444433332222',
            inicio: '2026-11-09T12:00:00Z',
            fin: '2026-11-10T12:00:00Z',
            duracion_ms: 30_000,
            cobertura: 'parcial',
          }),
        ),
      ),
    ).toBe('intervalo_cruza_dia_local');
  });

  it('rechaza un sobre cuyo id no coincide con datos.event_id', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          eventoBase({
            evento: { id: '99999999-9999-4999-8999-999999999999' },
          }),
        ),
      ),
    ).toBe('evento_invalido');
  });

  it('rechaza una fecha UTC inexistente', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({
            event_id: '12121212-1212-4212-8212-121212121212',
            inicio: '2026-02-30T12:00:00Z',
            fin: '2026-03-02T12:02:00Z',
            tramos_actividad: [
              { inicio: '2026-02-30T12:00:00Z', fin: '2026-02-30T12:00:30Z' },
            ],
          }),
        ),
      ),
    ).toBe('evento_invalido');
  });
});

describe('reglas de esquema', () => {
  it('rechaza campos desconocidos en datos', () => {
    const evento = {
      ...eventoBase(),
      datos: { ...DATOS_BASE, campo_extra: true },
    };
    expect(codigo(() => validarYNormalizar(evento))).toBe('evento_invalido');
  });

  it('rechaza identidad o destino en el cuerpo canónico', () => {
    const { suscripcion_id: _s, usuario_id: _u, ...payload } = DATOS_BASE;
    expect(() => validarPayloadUso(payload)).not.toThrow();
    expect(
      codigo(() =>
        validarPayloadUso({
          ...payload,
          usuario_id: '5b3a1c2d-4e6f-4a8b-9c0d-1e2f3a4b5c6d',
        }),
      ),
    ).toBe('evento_invalido');
  });

  it('rechaza event_id que no es UUID v4', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          datosInvalidos({ event_id: '22222222-2222-3222-8222-222222222222' }),
        ),
      ),
    ).toBe('evento_invalido');
  });

  it('rechaza instantes sin Z', () => {
    expect(
      codigo(() =>
        validarYNormalizar(datosInvalidos({ inicio: '2026-11-09T12:00:00' })),
      ),
    ).toBe('evento_invalido');
  });

  it('distingue una versión no soportada', () => {
    expect(
      codigo(() =>
        validarYNormalizar(
          eventoBase({
            datos: { version: 2 as unknown as 1 },
          }),
        ),
      ),
    ).toBe('version_no_soportada');
  });
});
