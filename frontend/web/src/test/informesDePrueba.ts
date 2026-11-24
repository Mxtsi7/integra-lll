import type { CatalogosSuscripciones, ResumenDelMes } from '@ojoalgasto/shared';

/** Un resumen inventado de un mes, de CLP y con un cobro. Solo para pruebas: nada de esto viene de un servicio. */
export function resumenDePrueba(sobrescribir: Partial<ResumenDelMes> = {}): ResumenDelMes {
  return {
    periodo: '2026-10',
    moneda: 'CLP',
    gasto_real: '5900.00',
    gasto_proyectado: '0.00',
    total_estimado: '5900.00',
    conteo_estados: { activo: 3, prueba: 0, por_confirmar: 0, cancelado: 0, fantasma: 0, total: 3 },
    ...sobrescribir,
  };
}

/** Un catálogo inventado con CLP y USD activos, y EUR inactivo. */
export const CATALOGOS_DE_PRUEBA: CatalogosSuscripciones = {
  monedas: [
    { codigo: 'USD', nombre: 'Dólar', activo: true, orden: 2 },
    { codigo: 'CLP', nombre: 'Peso chileno', activo: true, orden: 1 },
    { codigo: 'EUR', nombre: 'Euro', activo: false, orden: 3 },
  ],
  categorias: [],
  frecuencias: [{ codigo: 'mensual', nombre: 'Mensual' }],
  predeterminados: { moneda: 'CLP', categoria: null, frecuencia: 'mensual' },
};
