import {
  getPreferenciasAlertas,
  guardarPreferenciasAlertas,
  type PreferenciasAlertas,
  type PreferenciasEditables,
} from '@ojoalgasto/shared';
import type { IPreferenciasRepository } from '../domain/preferencias.types';

export class ApiPreferenciasRepository implements IPreferenciasRepository {
  async obtener(): Promise<PreferenciasAlertas> {
    return await getPreferenciasAlertas();
  }

  async guardar(cambios: Partial<PreferenciasEditables>): Promise<PreferenciasAlertas> {
    return await guardarPreferenciasAlertas(cambios);
  }
}

export const repositorioPreferenciasPorDefecto = new ApiPreferenciasRepository();
