import { describe, expect, it } from 'vitest';

import { decidirAccion } from '../src/consumidor/uso.consumer';
import { ErrorConflictoEvento, ErrorValidacionUso } from '../src/dominio/errores';

describe('decisión ante un mensaje fallido', () => {
  it('rechaza sin reintento los errores de contrato', () => {
    expect(decidirAccion(new ErrorValidacionUso('evento_invalido', 'x'))).toBe(
      'rechazar',
    );
    expect(decidirAccion(new ErrorConflictoEvento('x'))).toBe('rechazar');
  });

  it('reintenta los fallos transitorios', () => {
    expect(decidirAccion(new Error('base caída'))).toBe('reintentar');
    expect(decidirAccion({ code: 'ECONNREFUSED' })).toBe('reintentar');
  });
});
