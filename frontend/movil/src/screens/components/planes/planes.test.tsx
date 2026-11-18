// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ErrorDeApi, type ContratacionPlan, type PermisosPlan, type PlanDisponible } from '@ojoalgasto/shared';
import { crearAlmacenIntento, type AlmacenIntento, type IntentoGuardado } from './almacenIntento';
import { BloqueoPremium } from './BloqueoPremium';
import { PlanesContenido } from './PlanesContenido';
import {
  crearClaveIdempotencia,
  esUrlCheckoutValida,
  leerPermisos,
  mensajeDeErrorDeContratacion,
  MENSAJE_CHECKOUT_INSEGURO,
  MENSAJE_NO_RECUPERO_PENDIENTE,
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


/** Un almacén en memoria que además deja ver qué quedó guardado. */
function crearAlmacenEnMemoria(inicial: IntentoGuardado | null = null) {
  let valor = inicial;
  return {
    leer: vi.fn(async () => valor),
    guardar: vi.fn(async (intento: IntentoGuardado) => {
      valor = intento;
    }),
    borrar: vi.fn(async () => {
      valor = null;
    }),
    valor: () => valor,
  } satisfies AlmacenIntento & { valor: () => IntentoGuardado | null };
}

/** Una promesa que se resuelve a mano, para controlar en qué orden llegan las respuestas. */
function crearDiferido<T>() {
  let resolver: (valor: T) => void = () => {};
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

/**
 * Regresión de la revisión de #170: la contratación pendiente no puede perderse al salir y
 * reabrir Planes (el servidor respondería 409 y no habría cómo verificarla ni cancelarla).
 */
describe('Contratación pendiente que sobrevive a la pantalla', () => {
  function montarConAlmacen(api: ApiPlanes, almacen: AlmacenIntento) {
    const abrirUrl = vi.fn().mockResolvedValue(undefined);
    render(<PlanesContenido abrirUrl={abrirUrl} api={api} almacen={almacen} />);
    return { abrirUrl };
  }

  it('guarda la clave ANTES de pedir la contratación y el id apenas lo recibe', async () => {
    const respuesta = crearDiferido<ContratacionPlan>();
    const almacen = crearAlmacenEnMemoria();
    const api = crearApi({ iniciarContratacion: vi.fn().mockReturnValue(respuesta.promesa) });
    montarConAlmacen(api, almacen);
    fireEvent.click(await screen.findByTestId('contratar-premium'));

    await waitFor(() => expect(api.iniciarContratacion).toHaveBeenCalledTimes(1));
    const clave = (api.iniciarContratacion as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(almacen.valor()).toEqual({ clave, contratoId: null }); // la respuesta todavía no llegó

    await act(async () => respuesta.resolver(crearContrato()));
    await screen.findByTestId('contratacion-pendiente');
    expect(almacen.valor()).toEqual({ clave, contratoId: 'c-1' });
  });

  it('pendiente → salir → reabrir: restaura «Verificar» y «Cancelar» sin pedir otra contratación', async () => {
    const almacen = crearAlmacenEnMemoria();
    const api = crearApi();
    montarConAlmacen(api, almacen);
    fireEvent.click(await screen.findByTestId('contratar-premium'));
    await screen.findByTestId('contratacion-pendiente');

    cleanup(); // la persona sale de Planes
    montarConAlmacen(api, almacen); // y la reabre

    expect(await screen.findByTestId('contratacion-pendiente')).toBeTruthy();
    expect(screen.getByTestId('verificar-estado')).toBeTruthy();
    expect(screen.getByTestId('cancelar-contratacion')).toBeTruthy();
    expect(screen.queryByTestId('contratar-premium')).toBeNull();
    expect(api.getContratacion).toHaveBeenCalledWith('c-1');
    expect(api.iniciarContratacion).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('cancelar-contratacion'));
    expect(await screen.findByTestId('contratacion-cancelada')).toBeTruthy();
    expect(api.cancelarContratacion).toHaveBeenCalledWith('c-1');
    expect(almacen.valor()).toBeNull();
  });

  it('si la respuesta se perdió tras crear la contratación, al volver a contratar se usa la misma clave', async () => {
    const almacen = crearAlmacenEnMemoria();
    // El servidor creó la contratación, pero la respuesta nunca llegó a la app.
    const iniciarContratacion = vi.fn().mockRejectedValueOnce(new TypeError('se cortó')).mockResolvedValue(crearContrato());
    const api = crearApi({ iniciarContratacion });
    montarConAlmacen(api, almacen);
    fireEvent.click(await screen.findByTestId('contratar-premium'));
    await screen.findByTestId('error-planes');
    expect(almacen.valor()?.contratoId).toBeNull();

    cleanup();
    montarConAlmacen(api, almacen);
    fireEvent.click(await screen.findByTestId('contratar-premium'));

    expect(await screen.findByTestId('contratacion-pendiente')).toBeTruthy();
    expect(iniciarContratacion).toHaveBeenCalledTimes(2);
    expect(iniciarContratacion.mock.calls[1][0]).toBe(iniciarContratacion.mock.calls[0][0]);
    expect(almacen.valor()?.contratoId).toBe('c-1');
  });

  it('cuando la contratación termina se olvida el intento y el siguiente usa otra clave', async () => {
    const almacen = crearAlmacenEnMemoria();
    const api = crearApi({ getContratacion: vi.fn().mockResolvedValue(crearContrato({ estado: 'fallida' })) });
    montarConAlmacen(api, almacen);
    fireEvent.click(await screen.findByTestId('contratar-premium'));
    fireEvent.click(await screen.findByTestId('verificar-estado'));
    await screen.findByTestId('contratacion-fallida');
    expect(almacen.valor()).toBeNull();

    fireEvent.click(screen.getByTestId('contratar-premium'));
    await waitFor(() => expect(api.iniciarContratacion).toHaveBeenCalledTimes(2));
    const llamadas = (api.iniciarContratacion as ReturnType<typeof vi.fn>).mock.calls;
    expect(llamadas[1][0]).not.toBe(llamadas[0][0]);
  });

  it('si no se puede consultar el pendiente al reabrir, lo conserva y deja verificar o cancelar', async () => {
    const almacen = crearAlmacenEnMemoria({ clave: 'clave-1', contratoId: 'c-1' });
    const getContratacion = vi.fn().mockRejectedValueOnce(new TypeError('sin red')).mockResolvedValue(crearContrato());
    montarConAlmacen(crearApi({ getContratacion }), almacen);

    expect(await screen.findByTestId('contratacion-sin-cargar')).toBeTruthy();
    expect(screen.getByTestId('error-planes').textContent).toBe(MENSAJE_NO_RECUPERO_PENDIENTE);
    expect(screen.getByTestId('cancelar-contratacion')).toBeTruthy();
    expect(screen.queryByTestId('contratar-premium')).toBeNull();
    expect(almacen.valor()).not.toBeNull();

    fireEvent.click(screen.getByTestId('verificar-estado'));
    expect(await screen.findByTestId('contratacion-pendiente')).toBeTruthy();
  });

  it('si el id guardado ya no existe (404) se olvida y se puede contratar de nuevo', async () => {
    const almacen = crearAlmacenEnMemoria({ clave: 'clave-1', contratoId: 'c-viejo' });
    const getContratacion = vi.fn().mockRejectedValue(new ErrorDeApi('no existe', 404));
    montarConAlmacen(crearApi({ getContratacion }), almacen);

    await waitFor(() => expect(almacen.valor()).toBeNull());
    expect(await screen.findByTestId('contratar-premium')).toBeTruthy();
  });

  it('un 409 sin intento conocido avisa que no se pudo recuperar, en vez de pedir verificar algo inexistente', async () => {
    const api = crearApi({ iniciarContratacion: vi.fn().mockRejectedValue(new ErrorDeApi('pendiente', 409)) });
    montarConAlmacen(api, crearAlmacenEnMemoria());
    fireEvent.click(await screen.findByTestId('contratar-premium'));
    expect((await screen.findByTestId('error-planes')).textContent).toContain('no pudo recuperar');
    expect(screen.queryByTestId('verificar-estado')).toBeNull();
  });
});

describe('Almacén del intento de contratación', () => {
  function crearBackend() {
    const datos = new Map<string, string>();
    return {
      datos,
      getItemAsync: vi.fn(async (clave: string) => datos.get(clave) ?? null),
      setItemAsync: vi.fn(async (clave: string, valor: string) => {
        datos.set(clave, valor);
      }),
      deleteItemAsync: vi.fn(async (clave: string) => {
        datos.delete(clave);
      }),
    };
  }

  it('guarda y recupera el intento', async () => {
    const almacen = crearAlmacenIntento('u1:o1', crearBackend());
    await almacen.guardar({ clave: 'k', contratoId: 'c-1' });
    expect(await almacen.leer()).toEqual({ clave: 'k', contratoId: 'c-1' });
    await almacen.borrar();
    expect(await almacen.leer()).toBeNull();
  });

  it('cada persona y organización tiene el suyo: otro alcance no ve ni pisa el ajeno', async () => {
    const backend = crearBackend();
    const deAna = crearAlmacenIntento('u1:o1', backend);
    const deLuis = crearAlmacenIntento('u2:o1', backend);
    await deAna.guardar({ clave: 'k-ana', contratoId: 'c-1' });

    expect(await deLuis.leer()).toBeNull();
    await deLuis.guardar({ clave: 'k-luis', contratoId: null });
    expect(await deAna.leer()).toEqual({ clave: 'k-ana', contratoId: 'c-1' });
    expect(backend.datos.size).toBe(2);
    for (const nombre of backend.datos.keys()) expect(nombre).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('lo guardado con otro alcance dentro de la misma entrada se ignora', async () => {
    const backend = crearBackend();
    await crearAlmacenIntento('u1:o1', backend).guardar({ clave: 'k', contratoId: 'c-1' });
    // Mismo nombre de entrada, pero el contenido dice que es de otra organización.
    const [nombre, texto] = [...backend.datos.entries()][0];
    backend.datos.set(nombre, texto.replace('u1:o1', 'u1:otra'));
    expect(await crearAlmacenIntento('u1:o1', backend).leer()).toBeNull();
  });

  it('un contenido dañado o un fallo del almacenamiento no rompen nada', async () => {
    const backend = crearBackend();
    const almacen = crearAlmacenIntento('u1:o1', backend);
    backend.datos.set([...backend.datos.keys()][0] ?? 'contratacion_pendiente_u1_o1', 'esto no es JSON');
    expect(await almacen.leer()).toBeNull();

    const roto = {
      getItemAsync: vi.fn().mockRejectedValue(new Error('boom')),
      setItemAsync: vi.fn().mockRejectedValue(new Error('boom')),
      deleteItemAsync: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const sobreRoto = crearAlmacenIntento('u1:o1', roto);
    expect(await sobreRoto.leer()).toBeNull();
    await expect(sobreRoto.guardar({ clave: 'k', contratoId: null })).resolves.toBeUndefined();
    await expect(sobreRoto.borrar()).resolves.toBeUndefined();
  });
});

/**
 * Regresión de la revisión de #170: Restricciones sigue montada cuando la persona va a Planes,
 * contrata (o cancela) y vuelve. Al volver debe consultar de nuevo el plan.
 */
describe('Permisos al volver a Restricciones', () => {
  function montarRestricciones(getPermisosPlan: ReturnType<typeof vi.fn>) {
    let avisarRetorno: () => void = () => {};
    const alVolverAPantalla = (alVolver: () => void) => {
      avisarRetorno = alVolver;
      return () => {};
    };
    render(<RestriccionesPremiumContenido onVerPlanes={vi.fn()} alVolverAPantalla={alVolverAPantalla} api={{ getPermisosPlan }} />);
    return { volver: () => act(() => avisarRetorno()) };
  }

  it('Free → Premium: al volver de Planes muestra las funciones disponibles', async () => {
    const getPermisosPlan = vi.fn().mockResolvedValue(PERMISOS_FREE);
    const { volver } = montarRestricciones(getPermisosPlan);
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Requiere Premium');

    getPermisosPlan.mockResolvedValue(PERMISOS_PREMIUM); // contrató mientras tanto
    volver();
    await waitFor(() => expect(screen.getByTestId('funcion-asistente_financiero').textContent).toContain('Disponible'));
    expect(screen.getByTestId('todo-incluido')).toBeTruthy();
  });

  it('Premium → Free: al volver deja de mostrar lo que ya no incluye el plan', async () => {
    const getPermisosPlan = vi.fn().mockResolvedValue(PERMISOS_PREMIUM);
    const { volver } = montarRestricciones(getPermisosPlan);
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Disponible');

    getPermisosPlan.mockResolvedValue(PERMISOS_FREE); // canceló o venció mientras tanto
    volver();
    await waitFor(() => expect(screen.getByTestId('funcion-asistente_financiero').textContent).toContain('Requiere Premium'));
    expect(screen.getByTestId('ver-planes')).toBeTruthy();
  });

  it('mientras se confirma el plan no se muestra el estado anterior', async () => {
    const segunda = crearDiferido<PermisosPlan>();
    const getPermisosPlan = vi.fn().mockResolvedValueOnce(PERMISOS_PREMIUM).mockReturnValueOnce(segunda.promesa);
    const { volver } = montarRestricciones(getPermisosPlan);
    await screen.findByTestId('funcion-asistente_financiero');

    volver();
    await waitFor(() => expect(screen.queryByTestId('funcion-asistente_financiero')).toBeNull()); // bloqueado y cargando

    await act(async () => segunda.resolver(PERMISOS_FREE));
    expect((await screen.findByTestId('funcion-asistente_financiero')).textContent).toContain('Requiere Premium');
  });

  it('una respuesta anterior que llega tarde no pisa la más reciente', async () => {
    const lenta = crearDiferido<PermisosPlan>();
    const getPermisosPlan = vi.fn().mockReturnValueOnce(lenta.promesa).mockResolvedValue(PERMISOS_PREMIUM);
    const { volver } = montarRestricciones(getPermisosPlan);

    volver(); // se pide de nuevo antes de que llegue la primera
    await waitFor(() => expect(screen.getByTestId('funcion-asistente_financiero').textContent).toContain('Disponible'));

    await act(async () => lenta.resolver(PERMISOS_FREE)); // la vieja llega tarde, con el plan de antes
    expect(screen.getByTestId('funcion-asistente_financiero').textContent).toContain('Disponible');
  });
});

describe('Planes al volver a la pantalla sin pago pendiente', () => {
  it('vuelve a leer el plan: si cambió mientras la pantalla seguía montada, lo muestra', async () => {
    let avisarRetorno: () => void = () => {};
    const alVolverAPantalla = (alVolver: () => void) => {
      avisarRetorno = alVolver;
      return () => {};
    };
    const getPermisosPlan = vi.fn().mockResolvedValue(PERMISOS_FREE);
    await montarPlanes(crearApi({ getPermisosPlan }), { alVolverAPantalla });
    expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Gratuito');

    getPermisosPlan.mockResolvedValue(PERMISOS_PREMIUM);
    act(() => avisarRetorno());
    await waitFor(() => expect(screen.getByTestId('plan-vigente').textContent).toBe('Tu plan: Premium'));
  });
});
