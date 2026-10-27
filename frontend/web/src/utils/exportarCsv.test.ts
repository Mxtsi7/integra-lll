import { expect, it } from 'vitest';
import type { CatalogosSuscripciones, Suscripcion } from '@ojoalgasto/shared';
import { suscripcionesACsvBlob } from './exportarCsv';

it('conserva códigos e incluye etiquetas del catálogo escapadas en el CSV', async () => {
  const sub: Suscripcion = { id: '1', nombre: 'Netflix', monto: 100, moneda: 'CLP', categoria: 'hogar',
    frecuencia: 'mensual', estado: 'activo', fecha_proximo_cobro: '2026-11-20' };
  const catalogos: CatalogosSuscripciones = {
    monedas: [{ codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 }],
    categorias: [{ codigo: 'hogar', nombre: 'Casa, hogar', activo: false, orden: 1 }],
    frecuencias: [], predeterminados: { moneda: null, categoria: null, frecuencia: 'mensual' },
  };
  const csv = await suscripcionesACsvBlob([sub], catalogos).text();
  expect(csv).toContain('categoria_nombre,moneda_nombre');
  expect(csv).toContain('hogar,activo,"Casa, hogar",Peso chileno');
});
