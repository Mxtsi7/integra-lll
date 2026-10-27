import { pedir } from './cliente';
import type { Frecuencia } from '../tipos';

export interface OpcionCatalogo {
  codigo: string;
  nombre: string;
  activo: boolean;
  orden: number;
}

export interface CatalogosSuscripciones {
  monedas: OpcionCatalogo[];
  categorias: OpcionCatalogo[];
  frecuencias: { codigo: Frecuencia; nombre: string }[];
  predeterminados: { moneda: string | null; categoria: string | null; frecuencia: Frecuencia };
}

/** Incluye inactivos para mostrar etiquetas de suscripciones históricas. */
export function getCatalogosSuscripciones(): Promise<CatalogosSuscripciones> {
  return pedir('/catalogos/suscripciones/?incluir_inactivos=true');
}

export function getPaises(incluirInactivos = false): Promise<OpcionCatalogo[]> {
  return pedir(`/catalogos/paises/?incluir_inactivos=${incluirInactivos}`);
}
