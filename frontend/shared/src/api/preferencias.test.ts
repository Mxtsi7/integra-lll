import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pedir } from './cliente';
import {
  cambiosDePreferencias,
  getPreferenciasAlertas,
  guardarPreferenciasAlertas,
  preferenciasEditables,
  type PreferenciasAlertas,
} from './preferencias';

vi.mock('./cliente', () => ({ pedir: vi.fn() }));

const GUARDADAS: PreferenciasAlertas = {
  por_email: true,
  por_push: false,
  en_la_app: true,
  avisar_proximo_cobro: true,
  avisar_fin_prueba: true,
  avisar_alza_tarifa: true,
  avisar_doble_cobro: true,
  avisar_presupuesto_excedido: true,
  dias_anticipacion: 3,
  canales_disponibles: ['email', 'in_app'],
  canales_elegidos: ['email', 'in_app'],
  actualizado_en: '2026-10-20T15:30:00Z',
};

describe('preferencias de alertas (CH-30, FE-21)', () => {
  beforeEach(() => {
    vi.mocked(pedir).mockReset();
  });

  it('lee con GET /preferencias-alertas/', async () => {
    vi.mocked(pedir).mockResolvedValue(GUARDADAS);
    await expect(getPreferenciasAlertas()).resolves.toEqual(GUARDADAS);
    expect(pedir).toHaveBeenCalledWith('/preferencias-alertas/');
  });

  it('guarda con PATCH y manda tal cual los cambios', async () => {
    vi.mocked(pedir).mockResolvedValue({ ...GUARDADAS, por_push: true });
    await guardarPreferenciasAlertas({ por_push: true });
    expect(pedir).toHaveBeenCalledWith('/preferencias-alertas/', { method: 'PATCH', body: { por_push: true } });
  });

  it('los cambios son solo lo distinto, y nada si no cambió nada', () => {
    const editadas = { ...preferenciasEditables(GUARDADAS), por_push: true, avisar_doble_cobro: false };
    expect(cambiosDePreferencias(GUARDADAS, editadas)).toEqual({ por_push: true, avisar_doble_cobro: false });
    expect(cambiosDePreferencias(GUARDADAS, preferenciasEditables(GUARDADAS))).toEqual({});
  });

  it('lo editable no incluye lo que es del servidor (canales disponibles, fecha)', () => {
    const editables = preferenciasEditables(GUARDADAS);
    expect(Object.keys(editables)).not.toContain('canales_disponibles');
    expect(Object.keys(editables)).not.toContain('actualizado_en');
    expect(Object.keys(editables)).toHaveLength(9);
  });
});
