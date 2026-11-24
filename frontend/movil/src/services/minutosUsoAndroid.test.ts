import { describe, expect, it } from 'vitest';
import { calcularMinutosUsoAndroid } from './minutosUsoAndroid';

function tramo(inicio: string, fin: string, paquete = 'com.ejemplo.app') {
  return { paquete, inicioMs: Date.parse(inicio), finMs: Date.parse(fin) };
}

describe('minutos de uso Android', () => {
  it('une solapamientos por aplicación y reparte milisegundos por fecha local', () => {
    const datos = [
      tramo('2026-11-09T02:59:45Z', '2026-11-09T03:00:15Z'),
      tramo('2026-11-09T02:59:30Z', '2026-11-09T03:00:30Z'),
      tramo('2026-11-09T02:59:30Z', '2026-11-09T03:00:00Z', 'com.ejemplo.otra'),
    ];
    expect(calcularMinutosUsoAndroid(datos, 'America/Santiago')).toEqual([
      { paquete: 'com.ejemplo.app', fechaLocal: '2026-11-08', duracionMs: 30_000, minutos: 0.5 },
      { paquete: 'com.ejemplo.app', fechaLocal: '2026-11-09', duracionMs: 30_000, minutos: 0.5 },
      { paquete: 'com.ejemplo.otra', fechaLocal: '2026-11-08', duracionMs: 30_000, minutos: 0.5 },
    ]);
  });

  it('atribuye a un único día local las 23 horas de un cambio de horario', () => {
    const datos = [tramo('2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z')];
    expect(calcularMinutosUsoAndroid(datos, 'America/New_York')).toEqual([
      { paquete: 'com.ejemplo.app', fechaLocal: '2026-03-08', duracionMs: 82_800_000, minutos: 1380 },
    ]);
  });

  it('distingue entrada vacía y rechaza ventanas invertidas y zonas inválidas', () => {
    expect(calcularMinutosUsoAndroid([], 'UTC')).toEqual([]);
    expect(() => calcularMinutosUsoAndroid([], 'No/Existe')).toThrow(RangeError);
    expect(() => calcularMinutosUsoAndroid([{ paquete: 'com.app', inicioMs: 2, finMs: 1 }], 'UTC'))
      .toThrow(RangeError);
  });
});
