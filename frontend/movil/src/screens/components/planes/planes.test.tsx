// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorDeApi, type ContratacionPlan, type PermisosPlan, type PlanDisponible } from '@ojoalgasto/shared';
import { BloqueoPremium } from './BloqueoPremium';
import { PlanesContenido } from './PlanesContenido';
import {
  crearClaveIdempotencia,
  esUrlCheckoutValida,
  leerPermisos,
  mensajeDeErrorDeContratacion,
  MENSAJE_CHECKOUT_INSEGURO,
  MENSAJE_NO_SE_PUDO_ABRIR,
  MENSAJE_SIN_RED,
} from './reglasPlanes';
import { RestriccionesPremiumContenido } from './RestriccionesPremiumContenido';
import type { ApiPlanes } from './usePlanes';

const SIN_FEATURES = { asistente_financiero: false, recomendaciones_automaticas: false };
const CON_FEATURES = { asistente_financiero: true, recomendaciones_automaticas: true };
const PERMISOS_FREE: PermisosPlan = { plan: 'free', features: SIN_FEATURES };
const PERMISOS_PREMIUM: PermisosPlan = { plan: 'premium', features: CON_FEATURES };

const PLANES: PlanDisponible[] = [
  { codigo: 'free', nombre: 'Gratuito', precio: '0.00', moneda: 'USD', periodo: 'mensual', precio_demo: false, features: SIN_FEATURES },
  { codigo: 'premium', nombre: 'Premium', precio: '4.99', moneda: 'USD', periodo: 'mensual', precio_demo: true, features: CON_FEATURES },
];

function crearContrato(cambios: Partial<ContratacionPlan> = {}): ContratacionPlan {
  return {
    id: 'c-1',
    estado: 'pendiente',
    plan_id: 'premium',
    importe: '4.99',
    moneda: 'USD',
    precio_demo: true,
    vigente_desde: null,
    vigente_hasta: null,
    url_checkout: 'https://pagos.ejemplo.cl/checkout/c-1',
    url_retorno: 'https://app.ejemplo.cl/retorno?contratacion_id=c-1',
    permisos: PERMISOS_FREE, // el hook ignora este valor: manda `/usuarios/me/permisos/`
    ...cambios,
  };
}

function crearApi(cambios: Partial<ApiPlanes> = {}): ApiPlanes {
  return {
    getPlanes: vi.fn().mockResolvedValue(PLANES),
    getPermisosPlan: vi.fn().mockResolvedValue(PERMISOS_FREE),
    iniciarContratacion: vi.fn().mockResolvedValue(crearContrato()),
    getContratacion: vi.fn().mockResolvedValue(crearContrato()),
    cancelarContratacion: vi.fn().mockResolvedValue(crearContrato({ estado: 'cancelada' })),
    ...cambios,
  };
}

async function montarPlanes(api: ApiPlanes, extras: Partial<React.ComponentProps<typeof PlanesContenido>> = {}) {
  const abrirUrl = vi.fn().mockResolvedValue(undefined);
  render(<PlanesContenido abrirUrl={abrirUrl} api={api} {...extras} />);
  await screen.findByTestId('planes-contenido');
  return { abrirUrl };
}

afterEach(() => {
  cleanup();
});

describe('reglas de planes', () => {
  it('leerPermisos solo acepta la forma esperada', () => {
    expect(leerPermisos(PERMISOS_FREE)).toEqual(PERMISOS_FREE);
    expect(leerPermisos({ plan: 'oro', features: SIN_FEATURES })).toBeNull();
    expect(leerPermisos({ plan: 'premium' })).toBeNull();
    expect(leerPermisos(null)).toBeNull();
    expect(leerPermisos('premium')).toBeNull();
  });

  it('solo se abre un pago https y sin usuario incrustado', () => {
    expect(esUrlCheckoutValida('https://pagos.ejemplo.cl/checkout/1?x=2')).toBe(true);
    expect(esUrlCheckoutValida('http://pagos.ejemplo.cl/checkout')).toBe(false);
    expect(esUrlCheckoutValida('https://usuario:clave@malo.com/pago')).toBe(false);
    expect(esUrlCheckoutValida('https://pagos.ejemplo.cl@malo.com/pago')).toBe(false);
    expect(esUrlCheckoutValida('javascript:alert(1)')).toBe(false);
    expect(esUrlCheckoutValida('')).toBe(false);
    expect(esUrlCheckoutValida(undefined)).toBe(false);
  });

  it('la clave de idempotencia tiene forma de UUID y cambia en cada intento', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const a = crearClaveIdempotencia();
    const b = crearClaveIdempotencia();
    expect(a).toMatch(uuid);
    expect(a).not.toBe(b);
  });

  it('cada error del backend tiene su mensaje', () => {
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('x', 403))).toContain('titular');
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('x', 409))).toContain('pendiente');
    expect(mensajeDeErrorDeContratacion(new ErrorDeApi('x', 503))).toContain('no está disponible');
    expect(mensajeDeErrorDeContratacion(new TypeError('red'))).toBe(MENSAJE_SIN_RED);
    expect(mensajeDeErrorDeContratacion(new Error('raro'))).toContain('Inténtalo de nuevo');
  });
});

describe('Planes y contratación Premium móvil (AN-08)', () => {
  it('muestra los dos planes, el plan vigente según el servidor y el botón de contratar', async () => {
    await montarPlanes(crearApi());
    expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Gratuito');
    expect(screen.getByTestId('plan-free')).toBeTruthy();
    expect(screen.getByTestId('plan-premium')).toBeTruthy();
    expect(screen.getByTestId('plan-actual-free')).toBeTruthy();
    expect(screen.queryByTestId('plan-actual-premium')).toBeNull();
    expect(screen.getByTestId('contratar-premium')).toBeTruthy();
  });

  it('con Premium vigente no ofrece contratar', async () => {
    await montarPlanes(crearApi({ getPermisosPlan: vi.fn().mockResolvedValue(PERMISOS_PREMIUM) }));
    expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Premium');
    expect(screen.getByTestId('plan-actual-premium')).toBeTruthy();
    expect(screen.queryByTestId('contratar-premium')).toBeNull();
  });

  it('contratar manda una clave, abre el pago seguro y queda pendiente', async () => {
    const api = crearApi();
    const { abrirUrl } = await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));

    expect(await screen.findByTestId('contratacion-pendiente')).toBeTruthy();
    expect(api.iniciarContratacion).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(abrirUrl).toHaveBeenCalledWith('https://pagos.ejemplo.cl/checkout/c-1');
    expect(screen.getByTestId('verificar-estado')).toBeTruthy();
    expect(screen.getByTestId('cancelar-contratacion')).toBeTruthy();
    expect(screen.queryByTestId('contratar-premium')).toBeNull();
  });

  it('una dirección de pago insegura no se abre', async () => {
    const api = crearApi({ iniciarContratacion: vi.fn().mockResolvedValue(crearContrato({ url_checkout: 'http://malo.com/pago' })) });
    const { abrirUrl } = await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    expect((await screen.findByTestId('error-planes')).textContent).toBe(MENSAJE_CHECKOUT_INSEGURO);
    expect(abrirUrl).not.toHaveBeenCalled();
  });

  it('si no se puede abrir el navegador lo dice y la contratación sigue pendiente', async () => {
    const abrirUrl = vi.fn().mockRejectedValue(new Error('sin navegador'));
    render(<PlanesContenido abrirUrl={abrirUrl} api={crearApi()} />);
    fireEvent.click(await screen.findByTestId('contratar-premium'));
    expect((await screen.findByTestId('error-planes')).textContent).toBe(MENSAJE_NO_SE_PUDO_ABRIR);
    expect(screen.getByTestId('contratacion-pendiente')).toBeTruthy();
  });

  it('un pago "exitoso" no vuelve Premium a nadie mientras el servidor diga gratuito', async () => {
    const api = crearApi({ getContratacion: vi.fn().mockResolvedValue(crearContrato({ estado: 'exitosa' })) });
    await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    fireEvent.click(await screen.findByTestId('verificar-estado'));

    expect(await screen.findByTestId('contratacion-exitosa')).toBeTruthy();
    expect(screen.getByTestId('plan-activando')).toBeTruthy();
    expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Gratuito');
  });

  it('cuando el servidor confirma Premium, recién ahí se muestra Premium', async () => {
    const getPermisosPlan = vi.fn().mockResolvedValue(PERMISOS_FREE);
    const api = crearApi({ getPermisosPlan, getContratacion: vi.fn().mockResolvedValue(crearContrato({ estado: 'exitosa' })) });
    await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    fireEvent.click(await screen.findByTestId('verificar-estado'));
    await screen.findByTestId('plan-activando');

    getPermisosPlan.mockResolvedValue(PERMISOS_PREMIUM);
    fireEvent.click(screen.getByTestId('verificar-estado'));
    await waitFor(() => expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Premium'));
    expect(screen.queryByTestId('plan-activando')).toBeNull();
  });

  it('un pago fallido lo dice claro y deja intentar de nuevo', async () => {
    const api = crearApi({ getContratacion: vi.fn().mockResolvedValue(crearContrato({ estado: 'fallida' })) });
    await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    fireEvent.click(await screen.findByTestId('verificar-estado'));
    expect(await screen.findByTestId('contratacion-fallida')).toBeTruthy();
    expect(screen.getByTestId('contratar-premium').textContent).toContain('Intentar de nuevo');
  });

  it('cancelar la contratación muestra "cancelada" y vuelve a leer el plan', async () => {
    const api = crearApi();
    await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    fireEvent.click(await screen.findByTestId('cancelar-contratacion'));

    expect(await screen.findByTestId('contratacion-cancelada')).toBeTruthy();
    expect(api.cancelarContratacion).toHaveBeenCalledWith('c-1');
    expect(api.getPermisosPlan).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Gratuito');
  });

  it('un doble toque en contratar manda una sola petición', async () => {
    const api = crearApi();
    await montarPlanes(api);
    const boton = screen.getByTestId('contratar-premium');
    fireEvent.click(boton);
    fireEvent.click(boton);
    await screen.findByTestId('contratacion-pendiente');
    expect(api.iniciarContratacion).toHaveBeenCalledTimes(1);
  });

  it('si falla por red, el reintento usa la misma clave y no duplica la contratación', async () => {
    const iniciarContratacion = vi.fn().mockRejectedValueOnce(new TypeError('red')).mockResolvedValue(crearContrato());
    await montarPlanes(crearApi({ iniciarContratacion }));
    fireEvent.click(screen.getByTestId('contratar-premium'));
    expect((await screen.findByTestId('error-planes')).textContent).toBe(MENSAJE_SIN_RED);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    await screen.findByTestId('contratacion-pendiente');
    expect(iniciarContratacion).toHaveBeenCalledTimes(2);
    expect(iniciarContratacion.mock.calls[1][0]).toBe(iniciarContratacion.mock.calls[0][0]);
  });

  it('quien no es titular recibe un mensaje claro', async () => {
    const api = crearApi({ iniciarContratacion: vi.fn().mockRejectedValue(new ErrorDeApi('prohibido', 403)) });
    await montarPlanes(api);
    fireEvent.click(screen.getByTestId('contratar-premium'));
    expect((await screen.findByTestId('error-planes')).textContent).toContain('titular');
    expect(screen.queryByTestId('contratacion-pendiente')).toBeNull();
  });

  it('al volver a la pantalla con un pago pendiente consulta cómo terminó', async () => {
    let avisarRetorno: () => void = () => {};
    const alVolverAPantalla = (alVolver: () => void) => {
      avisarRetorno = alVolver;
      return () => {};
    };
    const api = crearApi();
    await montarPlanes(api, { alVolverAPantalla });

    act(() => avisarRetorno()); // todavía no hay contratación: no consulta nada
    expect(api.getContratacion).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('contratar-premium'));
    await screen.findByTestId('contratacion-pendiente');
    act(() => avisarRetorno());
    await waitFor(() => expect(api.getContratacion).toHaveBeenCalledWith('c-1'));
  });

  it('si no cargan los planes muestra error y reintentar vuelve a pedirlos', async () => {
    const getPlanes = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(PLANES);
    render(<PlanesContenido abrirUrl={vi.fn()} api={crearApi({ getPlanes })} />);
    fireEvent.click(await screen.findByRole('button', { name: /reintentar/i }));
    expect(await screen.findByTestId('planes-contenido')).toBeTruthy();
  });

  it('una respuesta de permisos con forma desconocida se trata como error, no como Premium', async () => {
    const api = crearApi({ getPermisosPlan: vi.fn().mockResolvedValue({ plan: 'oro' }) });
    render(<PlanesContenido abrirUrl={vi.fn()} api={api} />);
    expect(await screen.findByRole('button', { name: /reintentar/i })).toBeTruthy();
    expect(screen.queryByTestId('planes-contenido')).toBeNull();
  });
});

describe('Restricciones Premium móviles (AN-11)', () => {
  it('con plan gratuito marca las funciones como bloqueadas y lleva a los planes', async () => {
    const onVerPlanes = vi.fn();
    render(<RestriccionesPremiumContenido onVerPlanes={onVerPlanes} api={{ getPermisosPlan: vi.fn().mockResolvedValue(PERMISOS_FREE) }} />);
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Requiere Premium');
    expect(screen.getByTestId('funcion-recomendaciones_automaticas').textContent).toContain('Requiere Premium');
    fireEvent.click(screen.getByTestId('ver-planes'));
    expect(onVerPlanes).toHaveBeenCalledTimes(1);
  });

  it('con Premium todo aparece disponible y no hay botón de planes', async () => {
    render(<RestriccionesPremiumContenido onVerPlanes={vi.fn()} api={{ getPermisosPlan: vi.fn().mockResolvedValue(PERMISOS_PREMIUM) }} />);
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Disponible');
    expect(screen.getByTestId('todo-incluido')).toBeTruthy();
    expect(screen.queryByTestId('ver-planes')).toBeNull();
  });

  it('si no se puede confirmar el plan avisa que lo Premium sigue bloqueado y permite reintentar', async () => {
    const getPermisosPlan = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(PERMISOS_PREMIUM);
    render(<RestriccionesPremiumContenido onVerPlanes={vi.fn()} api={{ getPermisosPlan }} />);
    expect(await screen.findByTestId('funciones-bloqueadas')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Disponible');
  });
});

describe('BloqueoPremium (componente reutilizable de AN-11)', () => {
  const contenido = <span data-testid="contenido-premium">Asistente</span>;

  it('con la función permitida muestra el contenido', () => {
    render(
      <BloqueoPremium permisos={{ tipo: 'listo', datos: PERMISOS_PREMIUM }} feature="asistente_financiero" onVerPlanes={vi.fn()}>
        {contenido}
      </BloqueoPremium>,
    );
    expect(screen.getByTestId('contenido-premium')).toBeTruthy();
  });

  it('con plan gratuito lo reemplaza por el aviso y «Ver planes»', () => {
    const onVerPlanes = vi.fn();
    render(
      <BloqueoPremium permisos={{ tipo: 'listo', datos: PERMISOS_FREE }} feature="asistente_financiero" onVerPlanes={onVerPlanes}>
        {contenido}
      </BloqueoPremium>,
    );
    expect(screen.queryByTestId('contenido-premium')).toBeNull();
    fireEvent.click(screen.getByTestId('ver-planes-asistente_financiero'));
    expect(onVerPlanes).toHaveBeenCalledTimes(1);
  });

  it('mientras se confirma el plan, el contenido no se muestra', () => {
    render(
      <BloqueoPremium permisos={{ tipo: 'cargando' }} feature="asistente_financiero" onVerPlanes={vi.fn()}>
        {contenido}
      </BloqueoPremium>,
    );
    expect(screen.queryByTestId('contenido-premium')).toBeNull();
    expect(screen.getByText('Verificando tu plan…')).toBeTruthy();
  });

  it('si no se pudo confirmar el plan (estado desconocido) sigue bloqueado y ofrece reintentar', () => {
    const onReintentar = vi.fn();
    render(
      <BloqueoPremium permisos={{ tipo: 'error' }} feature="recomendaciones_automaticas" onVerPlanes={vi.fn()} onReintentar={onReintentar}>
        {contenido}
      </BloqueoPremium>,
    );
    expect(screen.queryByTestId('contenido-premium')).toBeNull();
    fireEvent.click(screen.getByTestId('reintentar-recomendaciones_automaticas'));
    expect(onReintentar).toHaveBeenCalledTimes(1);
  });

  it('una función en false o ausente del servidor no cuenta como permitida', () => {
    render(
      <BloqueoPremium
        permisos={{ tipo: 'listo', datos: { plan: 'premium', features: { asistente_financiero: true } as never } }}
        feature="recomendaciones_automaticas"
        onVerPlanes={vi.fn()}
      >
        {contenido}
      </BloqueoPremium>,
    );
    expect(screen.queryByTestId('contenido-premium')).toBeNull();
  });
});
