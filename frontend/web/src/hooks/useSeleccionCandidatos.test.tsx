// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import type { CandidatoDetectado } from '@ojoalgasto/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { candidatoDePrueba } from '../test/candidatosDePrueba';
import { useSeleccionCandidatos } from './useSeleccionCandidatos';

// S3-CH-07: la selección es solo estado de la interfaz; no hay ninguna llamada a un servicio.
const SPOTIFY = candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' });
const NETFLIX = candidatoDePrueba({ id: 'c-2', servicio: 'Netflix' });
const SIN_PROVEEDOR = candidatoDePrueba({ id: 'c-3', servicio: null, servicio_texto: 'PAGO 4471', servicio_resultado: 'desconocido' });
const CONFIRMADO = candidatoDePrueba({ id: 'c-4', estado: 'confirmado', estado_legible: 'Confirmado', aplicacion: 'por_enviar' });
const RECHAZADO = candidatoDePrueba({ id: 'c-5', estado: 'rechazado', estado_legible: 'Rechazado' });

const montar = (candidatos: readonly CandidatoDetectado[] | null) =>
  renderHook(({ lista }) => useSeleccionCandidatos(lista), { initialProps: { lista: candidatos } });

const ids = (conjunto: ReadonlySet<string>) => [...conjunto].sort();

afterEach(() => {
  cleanup();
});

describe('qué se puede seleccionar (S3-CH-07)', () => {
  it('empieza sin nada seleccionado y cuenta solo los cobros que esperan una decisión', () => {
    const { result } = montar([SPOTIFY, NETFLIX, CONFIRMADO, RECHAZADO]);

    expect(ids(result.current.seleccionados)).toEqual([]);
    expect(result.current.cantidadSeleccionable).toBe(2);
  });

  it('un cobro ya confirmado o rechazado no queda como pendiente seleccionable', () => {
    const { result } = montar([SPOTIFY, CONFIRMADO, RECHAZADO]);

    act(() => result.current.alAlternar('c-4'));
    act(() => result.current.alAlternar('c-5'));

    expect(ids(result.current.seleccionados)).toEqual([]);
  });

  it('un id que no está en la lista no se puede seleccionar', () => {
    const { result } = montar([SPOTIFY]);

    act(() => result.current.alAlternar('c-99'));

    expect(ids(result.current.seleccionados)).toEqual([]);
  });
});

describe('seleccionar y quitar (S3-CH-07)', () => {
  it('alternar agrega y quita un cobro, y no toca a los demás', () => {
    const { result } = montar([SPOTIFY, NETFLIX]);

    act(() => result.current.alAlternar('c-1'));
    act(() => result.current.alAlternar('c-2'));
    expect(ids(result.current.seleccionados)).toEqual(['c-1', 'c-2']);

    act(() => result.current.alAlternar('c-1'));
    expect(ids(result.current.seleccionados)).toEqual(['c-2']);
  });

  it('seleccionar la página elige todos los que esperan decisión, y volver a hacerlo los quita', () => {
    const { result } = montar([SPOTIFY, NETFLIX, CONFIRMADO]);

    act(() => result.current.alAlternarPagina());
    expect(ids(result.current.seleccionados)).toEqual(['c-1', 'c-2']);

    act(() => result.current.alAlternarPagina());
    expect(ids(result.current.seleccionados)).toEqual([]);
  });

  it('con algunos ya elegidos, seleccionar la página completa el resto en vez de quitarlos', () => {
    const { result } = montar([SPOTIFY, NETFLIX]);
    act(() => result.current.alAlternar('c-1'));

    act(() => result.current.alAlternarPagina());

    expect(ids(result.current.seleccionados)).toEqual(['c-1', 'c-2']);
  });

  it('seleccionar la página sin cobros pendientes no elige nada', () => {
    const { result } = montar([CONFIRMADO, RECHAZADO]);

    act(() => result.current.alAlternarPagina());

    expect(ids(result.current.seleccionados)).toEqual([]);
    expect(result.current.cantidadSeleccionable).toBe(0);
  });

  it('limpiar deja la selección vacía', () => {
    const { result } = montar([SPOTIFY, NETFLIX]);
    act(() => result.current.alAlternarPagina());

    act(() => result.current.alLimpiar());

    expect(ids(result.current.seleccionados)).toEqual([]);
  });
});

describe('qué se puede confirmar y qué solo rechazar (S3-CH-07)', () => {
  it('sin proveedor reconocido el cobro se puede rechazar, pero no entra entre los que se confirman', () => {
    const { result } = montar([SPOTIFY, SIN_PROVEEDOR]);

    act(() => result.current.alAlternarPagina());

    expect(ids(result.current.seleccionados)).toEqual(['c-1', 'c-3']);
    expect(result.current.idsParaConfirmar).toEqual(['c-1']);
  });

  it('solo cuentan los seleccionados: un cobro con proveedor sin elegir no se confirma', () => {
    const { result } = montar([SPOTIFY, NETFLIX]);

    act(() => result.current.alAlternar('c-2'));

    expect(result.current.idsParaConfirmar).toEqual(['c-2']);
  });
});

describe('selección coherente al refrescar (S3-CH-07)', () => {
  it('al pasar a otra página lo que ya no se ve deja de estar seleccionado, y no vuelve al regresar', () => {
    const { result, rerender } = montar([SPOTIFY, NETFLIX]);
    act(() => result.current.alAlternarPagina());

    rerender({ lista: [candidatoDePrueba({ id: 'c-10' }), candidatoDePrueba({ id: 'c-11' })] });
    expect(ids(result.current.seleccionados)).toEqual([]);

    rerender({ lista: [SPOTIFY, NETFLIX] });
    expect(ids(result.current.seleccionados)).toEqual([]);
  });

  it('mientras la lista se recarga no hay nada seleccionado, y los que siguen pendientes lo siguen estando al volver', () => {
    const { result, rerender } = montar([SPOTIFY, NETFLIX]);
    act(() => result.current.alAlternarPagina());

    rerender({ lista: null });
    expect(ids(result.current.seleccionados)).toEqual([]);

    rerender({ lista: [SPOTIFY, NETFLIX] });
    expect(ids(result.current.seleccionados)).toEqual(['c-1', 'c-2']);
  });

  it('un cobro que se resolvió mientras tanto sale de la selección y los pendientes se conservan', () => {
    const { result, rerender } = montar([SPOTIFY, NETFLIX]);
    act(() => result.current.alAlternarPagina());

    rerender({ lista: [candidatoDePrueba({ id: 'c-1', estado: 'confirmado', estado_legible: 'Confirmado' }), NETFLIX] });

    expect(ids(result.current.seleccionados)).toEqual(['c-2']);
    expect(result.current.idsParaConfirmar).toEqual(['c-2']);
    expect(result.current.cantidadSeleccionable).toBe(1);
  });

  it('un cobro resuelto que vuelve a aparecer como pendiente no se selecciona solo', () => {
    const { result, rerender } = montar([SPOTIFY]);
    act(() => result.current.alAlternar('c-1'));
    rerender({ lista: [candidatoDePrueba({ id: 'c-1', estado: 'confirmado' })] });

    rerender({ lista: [SPOTIFY] });

    expect(ids(result.current.seleccionados)).toEqual([]);
  });

  it('con una lista vacía la selección queda vacía', () => {
    const { result, rerender } = montar([SPOTIFY]);
    act(() => result.current.alAlternar('c-1'));

    rerender({ lista: [] });

    expect(ids(result.current.seleccionados)).toEqual([]);
    expect(result.current.cantidadSeleccionable).toBe(0);
  });
});
