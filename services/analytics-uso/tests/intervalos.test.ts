import { describe, expect, it } from 'vitest';

import {
  duracionUnionMs,
  huecosEnVentana,
  unirIntervalos,
} from '../src/dominio/intervalos';

const t = (iso: string) => Date.parse(iso);

describe('unión temporal de tramos (S3-VI-14)', () => {
  it('dos fuentes con la misma ventana de 2 min acreditan 2 min, no 4', () => {
    const tramos = [
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:02:00Z') },
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:02:00Z') },
    ];
    expect(duracionUnionMs(tramos)).toBe(120_000);
    expect(unirIntervalos(tramos)).toEqual([
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:02:00Z') },
    ]);
  });

  it('solape parcial de 1 min: la unión es 3 min, no 4', () => {
    const tramos = [
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:02:00Z') },
      { inicio: t('2026-11-09T12:01:00Z'), fin: t('2026-11-09T12:03:00Z') },
    ];
    expect(duracionUnionMs(tramos)).toBe(180_000);
  });

  it('dos tramos de 30 s con 10 s de solape: 50 s exactos', () => {
    const tramos = [
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:00:30Z') },
      { inicio: t('2026-11-09T12:00:20Z'), fin: t('2026-11-09T12:00:50Z') },
    ];
    expect(duracionUnionMs(tramos)).toBe(50_000);
  });

  it('30 s + 30 s separados por un hueco conservan 60 s', () => {
    const tramos = [
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:00:30Z') },
      { inicio: t('2026-11-09T12:01:00Z'), fin: t('2026-11-09T12:01:30Z') },
    ];
    expect(duracionUnionMs(tramos)).toBe(60_000);
  });

  it('fusiona intervalos que se tocan y recorta los contenidos', () => {
    const tramos = [
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:00:30Z') },
      { inicio: t('2026-11-09T12:00:30Z'), fin: t('2026-11-09T12:01:00Z') },
      { inicio: t('2026-11-09T12:00:10Z'), fin: t('2026-11-09T12:00:20Z') },
    ];
    expect(unirIntervalos(tramos)).toEqual([
      { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:01:00Z') },
    ]);
    expect(duracionUnionMs(tramos)).toBe(60_000);
  });

  it('lista vacía o de duración cero aporta cero', () => {
    expect(duracionUnionMs([])).toBe(0);
    expect(
      duracionUnionMs([
        { inicio: t('2026-11-09T12:00:00Z'), fin: t('2026-11-09T12:00:00Z') },
      ]),
    ).toBe(0);
  });

  it('no modifica los intervalos de entrada', () => {
    const tramos = [
      { inicio: 0, fin: 10 },
      { inicio: 5, fin: 20 },
    ];
    unirIntervalos(tramos);
    expect(tramos).toEqual([
      { inicio: 0, fin: 10 },
      { inicio: 5, fin: 20 },
    ]);
  });
});

describe('huecos de cobertura', () => {
  const dia = {
    inicio: t('2026-11-09T03:00:00Z'),
    fin: t('2026-11-10T03:00:00Z'),
  };

  it('una ventana completa no deja huecos', () => {
    expect(huecosEnVentana([dia], dia)).toEqual([]);
  });

  it('dos ventanas que abarcan 24 h pero dejan 2 h sin observar no acreditan el día', () => {
    const ventanas = [
      { inicio: t('2026-11-09T03:00:00Z'), fin: t('2026-11-09T07:00:00Z') },
      { inicio: t('2026-11-09T09:00:00Z'), fin: t('2026-11-10T03:00:00Z') },
    ];
    expect(huecosEnVentana(ventanas, dia)).toEqual([
      { inicio: t('2026-11-09T07:00:00Z'), fin: t('2026-11-09T09:00:00Z') },
    ]);
  });

  it('recorta ventanas que salen de la ventana consultada', () => {
    const ventanas = [
      { inicio: t('2026-11-09T01:00:00Z'), fin: t('2026-11-09T05:00:00Z') },
    ];
    expect(huecosEnVentana(ventanas, dia)).toEqual([
      { inicio: t('2026-11-09T05:00:00Z'), fin: t('2026-11-10T03:00:00Z') },
    ]);
  });
});
