// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorDeApi, type ExplicacionRecomendacion, type Recomendacion } from '@ojoalgasto/shared';
import { RecomendacionesContenido } from './RecomendacionesContenido';
import { formatearAhorro, leerListaRecomendaciones } from './reglasRecomendaciones';
import type { ApiRecomendaciones } from './useRecomendaciones';

function crearRecomendacion(id: string, cambios: Partial<Recomendacion> = {}): Recomendacion {
  return { id, suscripcion_id: `s-${id}`, nombre: `Servicio ${id}`, categoria: 'Streaming', motivo: `Motivo ${id}`, ahorro_estimado: 5000, moneda: 'CLP', ...cambios };
}

function crearExplicacion(cambios: Partial<ExplicacionRecomendacion> = {}): ExplicacionRecomendacion {
  return {
    id: 'r1', suscripcion_id: 's-r1', explicacion: 'Pagas dos servicios parecidos.', fuente: 'reglas', estado: 'disponible',
    motivo: null, ahorro_estimado: 5000, moneda: 'CLP', base_calculo: 'Precio mensual del servicio duplicado', evidencia: null,
    uso: 'no_evaluado', advertencia_uso: 'No medimos cuánto usas este servicio.', ...cambios,
  };
}

function crearApi(cambios: Partial<ApiRecomendaciones> = {}): ApiRecomendaciones {
  return {
    getRecomendaciones: vi.fn().mockResolvedValue({ results: [crearRecomendacion('r1'), crearRecomendacion('r2')] }),
    explicarRecomendacion: vi.fn().mockResolvedValue(crearExplicacion()),
    descartarRecomendacion: vi.fn().mockResolvedValue({ recomendacion_id: 'r1', vigente_hasta: null, descartado: true }),
    ...cambios,
  };
}

afterEach(() => {
  cleanup();
});

describe('reglas de recomendaciones', () => {
  it('acepta el envoltorio con results y también un arreglo suelto', () => {
    expect(leerListaRecomendaciones({ results: [] })?.disponible).toBe(true);
    expect(leerListaRecomendaciones([crearRecomendacion('r1')])?.recomendaciones).toHaveLength(1);
  });

  it('una forma desconocida es error, no lista vacía', () => {
    expect(leerListaRecomendaciones({ algo: 1 })).toBeNull();
    expect(leerListaRecomendaciones(null)).toBeNull();
    expect(leerListaRecomendaciones('texto')).toBeNull();
  });

  it('lee el motivo de que no haya sugerencias', () => {
    const lista = leerListaRecomendaciones({ results: [], disponible: false, motivo_sin_sugerencias: 'Falta configurar el umbral.' });
    expect(lista).toMatchObject({ disponible: false, motivoSinSugerencias: 'Falta configurar el umbral.' });
  });

  it('el ahorro sin dato es null y una moneda desconocida no rompe', () => {
    expect(formatearAhorro(undefined, 'CLP')).toBeNull();
    expect(formatearAhorro(10, 'ZZ')).toBe('ZZ 10');
  });
});

describe('Recomendaciones móvil (AN-05, AN-21, AN-25)', () => {
  it('muestra las tarjetas con motivo y ahorro', async () => {
    render(<RecomendacionesContenido api={crearApi()} />);
    expect(await screen.findByTestId('recomendacion-r1')).toBeTruthy();
    expect(screen.getByText('Motivo r2')).toBeTruthy();
    expect(screen.getByTestId('ahorro-r1').textContent).toContain('5.000');
  });

  it('respuesta vacía y fallo de API se distinguen', async () => {
    const vacia = crearApi({ getRecomendaciones: vi.fn().mockResolvedValue({ results: [], motivo_sin_sugerencias: 'Aún no hay cobros suficientes.' }) });
    render(<RecomendacionesContenido api={vacia} />);
    expect(await screen.findByText('No hay recomendaciones por ahora')).toBeTruthy();
    expect(screen.getByText('Aún no hay cobros suficientes.')).toBeTruthy();
    cleanup();

    const fallida = crearApi({ getRecomendaciones: vi.fn().mockRejectedValue(new Error('sin red')) });
    render(<RecomendacionesContenido api={fallida} />);
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeTruthy();
    expect(screen.queryByText('No hay recomendaciones por ahora')).toBeNull();
  });

  it('una respuesta con forma desconocida se muestra como error', async () => {
    render(<RecomendacionesContenido api={crearApi({ getRecomendaciones: vi.fn().mockResolvedValue({ algo: 1 }) })} />);
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeTruthy();
  });

  it('con 403 explica que es Premium y ofrece ver planes', async () => {
    const onVerPlanes = vi.fn();
    const api = crearApi({ getRecomendaciones: vi.fn().mockRejectedValue(new ErrorDeApi('Esta función requiere Premium vigente', 403)) });
    render(<RecomendacionesContenido api={api} onVerPlanes={onVerPlanes} />);
    expect(await screen.findByText('Las recomendaciones son Premium')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ver planes' }));
    expect(onVerPlanes).toHaveBeenCalledTimes(1);
  });

  it('ver detalle pide la explicación y ocultar lo cierra', async () => {
    const api = crearApi();
    render(<RecomendacionesContenido api={api} />);
    fireEvent.click(await screen.findByTestId('ver-detalle-r1'));
    expect(await screen.findByText('Pagas dos servicios parecidos.')).toBeTruthy();
    expect(api.explicarRecomendacion).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByTestId('ocultar-detalle-r1'));
    expect(screen.queryByTestId('detalle-r1')).toBeNull();
  });

  it('con datos insuficientes muestra el motivo y no inventa explicación', async () => {
    const api = crearApi({ explicarRecomendacion: vi.fn().mockResolvedValue(crearExplicacion({ estado: 'datos_insuficientes', motivo: 'Faltan meses de historial.' })) });
    render(<RecomendacionesContenido api={api} />);
    fireEvent.click(await screen.findByTestId('ver-detalle-r1'));
    expect(await screen.findByText('Faltan meses de historial.')).toBeTruthy();
    expect(screen.queryByText('Pagas dos servicios parecidos.')).toBeNull();
  });

  it('si falla el detalle ofrece reintentar', async () => {
    const explicarRecomendacion = vi.fn().mockRejectedValueOnce(new Error('500')).mockResolvedValue(crearExplicacion());
    render(<RecomendacionesContenido api={crearApi({ explicarRecomendacion })} />);
    fireEvent.click(await screen.findByTestId('ver-detalle-r1'));
    fireEvent.click(await screen.findByTestId('reintentar-detalle-r1'));
    expect(await screen.findByText('Pagas dos servicios parecidos.')).toBeTruthy();
  });

  it('"No me interesa" quita la tarjeta cuando el backend confirma', async () => {
    const api = crearApi();
    render(<RecomendacionesContenido api={api} />);
    fireEvent.click(await screen.findByTestId('descartar-r1'));
    await waitFor(() => expect(screen.queryByTestId('recomendacion-r1')).toBeNull());
    expect(api.descartarRecomendacion).toHaveBeenCalledWith('r1');
    expect(screen.getByTestId('recomendacion-r2')).toBeTruthy();
  });

  it('si falla el descarte, la tarjeta sigue y se avisa', async () => {
    const api = crearApi({ descartarRecomendacion: vi.fn().mockRejectedValue(new Error('500')) });
    render(<RecomendacionesContenido api={api} />);
    fireEvent.click(await screen.findByTestId('descartar-r1'));
    expect(await screen.findByTestId('error-recomendaciones')).toBeTruthy();
    expect(screen.getByTestId('recomendacion-r1')).toBeTruthy();
  });

  it('un doble toque en "No me interesa" manda una sola petición', async () => {
    const api = crearApi();
    render(<RecomendacionesContenido api={api} />);
    const boton = await screen.findByTestId('descartar-r1');
    fireEvent.click(boton);
    fireEvent.click(boton);
    await waitFor(() => expect(screen.queryByTestId('recomendacion-r1')).toBeNull());
    expect(api.descartarRecomendacion).toHaveBeenCalledTimes(1);
  });

  it('"Actualizar" vuelve a pedir la lista y una recomendación descartada ya no aparece', async () => {
    const getRecomendaciones = vi
      .fn()
      .mockResolvedValueOnce({ results: [crearRecomendacion('r1'), crearRecomendacion('r2')] })
      .mockResolvedValue({ results: [crearRecomendacion('r2')] });
    render(<RecomendacionesContenido api={crearApi({ getRecomendaciones })} />);
    await screen.findByTestId('recomendacion-r1');
    fireEvent.click(screen.getByTestId('actualizar-recomendaciones'));
    await waitFor(() => expect(screen.queryByTestId('recomendacion-r1')).toBeNull());
    expect(getRecomendaciones).toHaveBeenCalledTimes(2);
  });
});
