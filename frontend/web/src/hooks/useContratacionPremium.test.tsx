// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelarContratacion,
  ErrorDeApi,
  getContratacion,
  getPlanes,
  iniciarContratacion,
  type ContratacionPlan,
  type PlanDisponible,
} from '@ojoalgasto/shared';
import { MENSAJE_CHECKOUT_INSEGURO, MENSAJE_NO_RECUPERO_PENDIENTE, MENSAJE_PENDIENTE_NO_RECUPERABLE } from '../components/Planes/reglasContratacion';
import { useContratacionPremium } from './useContratacionPremium';

// Solo se simulan las llamadas de red y la sesión. El hook y las reglas son los reales.
vi.mock('@ojoalgasto/shared', async (importOriginal) => {
  const real = await importOriginal<typeof import('@ojoalgasto/shared')>();
  return { ...real, iniciarContratacion: vi.fn(), getContratacion: vi.fn(), cancelarContratacion: vi.fn(), getPlanes: vi.fn() };
});

const sesion = vi.hoisted(() => ({ marca: 1, usuario: { id: '7', organizacion_id: 'org-a', rol: 'titular' } as { id: string; organizacion_id: string; rol: string } | null }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ usuario: sesion.usuario, capturarSesion: () => sesion.marca }),
}));

const URL_PAGO = 'https://pagos.ejemplo.cl/api/pagos/mock/?token=t';
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function contrato(extra: Partial<ContratacionPlan> = {}): ContratacionPlan {
  return {
    id: 'c-1',
    estado: 'pendiente',
    plan_id: 'premium',
    importe: '4990.00',
    moneda: 'CLP',
    precio_demo: true,
    vigente_desde: null,
    vigente_hasta: null,
    url_checkout: URL_PAGO,
    url_retorno: 'https://app.ejemplo.cl/planes/retorno?contratacion_id=c-1',
    permisos: { plan: 'free', features: { asistente_financiero: false, recomendaciones_automaticas: false } },
    ...extra,
  };
}

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

const CLAVE_DEL_INTENTO = 'contratacion_pendiente_7:org-a';

describe('useContratacionPremium', () => {
  let irAlCheckout: ReturnType<typeof vi.fn>;
  let alPlanCambiar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    window.localStorage.clear();
    sesion.marca = 1;
    sesion.usuario = { id: '7', organizacion_id: 'org-a', rol: 'titular' };
    irAlCheckout = vi.fn();
    alPlanCambiar = vi.fn();
    vi.mocked(iniciarContratacion).mockReset();
    vi.mocked(getContratacion).mockReset();
    vi.mocked(cancelarContratacion).mockReset();
    vi.mocked(getPlanes).mockReset();
    vi.mocked(getPlanes).mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  function montar() {
    return renderHook(() => useContratacionPremium({ irAlCheckout, alPlanCambiar }));
  }

  it('guarda el intento y manda a la persona al pago cuando la contratación queda pendiente', async () => {
    vi.mocked(iniciarContratacion).mockResolvedValue(contrato());
    const { result } = montar();

    await act(() => result.current.contratar());

    const [claveEnviada] = vi.mocked(iniciarContratacion).mock.calls[0];
    expect(claveEnviada).toMatch(PATRON_UUID);
    expect(irAlCheckout).toHaveBeenCalledWith(URL_PAGO);
    expect(JSON.parse(window.localStorage.getItem(CLAVE_DEL_INTENTO) ?? 'null')).toEqual({
      alcance: '7:org-a',
      clave: claveEnviada,
      contratoId: 'c-1',
    });
    expect(result.current.contrato?.id).toBe('c-1');
  });

  it('un reintento tras perder la respuesta manda la misma clave de idempotencia', async () => {
    vi.mocked(iniciarContratacion)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(contrato());
    const { result } = montar();

    await act(() => result.current.contratar());
    expect(result.current.mensajeError).toMatch(/conectar/);

    await act(() => result.current.contratar());

    const [primeraClave] = vi.mocked(iniciarContratacion).mock.calls[0];
    const [segundaClave] = vi.mocked(iniciarContratacion).mock.calls[1];
    expect(segundaClave).toBe(primeraClave);
    expect(irAlCheckout).toHaveBeenCalledTimes(1);
  });

  it('si el titular no puede contratar, lo dice sin mandar a ningún pago', async () => {
    vi.mocked(iniciarContratacion).mockRejectedValue(new ErrorDeApi('prohibido', 403));
    const { result } = montar();

    await act(() => result.current.contratar());

    expect(result.current.mensajeError).toMatch(/titular/);
    expect(irAlCheckout).not.toHaveBeenCalled();
  });

  it('no abre un pago cuya dirección no es segura y lo deja como pendiente para revisarlo', async () => {
    vi.mocked(iniciarContratacion).mockResolvedValue(contrato({ url_checkout: 'http://pagos.ejemplo.cl/x' }));
    const { result } = montar();

    await act(() => result.current.contratar());

    expect(irAlCheckout).not.toHaveBeenCalled();
    expect(result.current.mensajeError).toBe(MENSAJE_CHECKOUT_INSEGURO);
    expect(result.current.contrato?.estado).toBe('pendiente');
  });

  it('un doble toque manda una sola petición', async () => {
    const respuesta = diferida<ContratacionPlan>();
    vi.mocked(iniciarContratacion).mockReturnValue(respuesta.promesa);
    const { result } = montar();

    let primera!: Promise<void>;
    act(() => {
      primera = result.current.contratar();
      void result.current.contratar();
    });
    respuesta.resolver(contrato());
    await act(() => primera);

    expect(iniciarContratacion).toHaveBeenCalledTimes(1);
  });

  it('si la contratación ya terminó al crearse, no abre pago y vuelve a leer el plan', async () => {
    vi.mocked(iniciarContratacion).mockResolvedValue(contrato({ estado: 'exitosa' }));
    const { result } = montar();

    await act(() => result.current.contratar());

    expect(irAlCheckout).not.toHaveBeenCalled();
    expect(alPlanCambiar).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(CLAVE_DEL_INTENTO)).toBeNull();
  });

  it('al volver a la página recupera una contratación pendiente guardada', async () => {
    window.localStorage.setItem(CLAVE_DEL_INTENTO, JSON.stringify({ alcance: '7:org-a', clave: 'k-1', contratoId: 'c-9' }));
    vi.mocked(getContratacion).mockResolvedValue(contrato({ id: 'c-9' }));
    const { result } = montar();

    await waitFor(() => expect(result.current.contrato?.id).toBe('c-9'));
    expect(getContratacion).toHaveBeenCalledWith('c-9');
  });

  it('si la contratación guardada ya no existe, borra el intento', async () => {
    window.localStorage.setItem(CLAVE_DEL_INTENTO, JSON.stringify({ alcance: '7:org-a', clave: 'k-1', contratoId: 'c-9' }));
    vi.mocked(getContratacion).mockRejectedValue(new ErrorDeApi('no existe', 404));
    const { result } = montar();

    await waitFor(() => expect(window.localStorage.getItem(CLAVE_DEL_INTENTO)).toBeNull());
    expect(result.current.contrato).toBeNull();
  });

  it('si no puede recuperar la pendiente por un fallo temporal, la conserva y lo dice', async () => {
    window.localStorage.setItem(CLAVE_DEL_INTENTO, JSON.stringify({ alcance: '7:org-a', clave: 'k-1', contratoId: 'c-9' }));
    vi.mocked(getContratacion).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = montar();

    await waitFor(() => expect(result.current.mensajeError).toBe(MENSAJE_NO_RECUPERO_PENDIENTE));
    expect(result.current.idSinCargar).toBe('c-9');
    expect(window.localStorage.getItem(CLAVE_DEL_INTENTO)).not.toBeNull();
  });

  it('un 409 sin intento recuperable explica que la pendiente no está en este equipo', async () => {
    vi.mocked(iniciarContratacion).mockRejectedValue(new ErrorDeApi('pendiente', 409));
    const { result } = montar();

    await act(() => result.current.contratar());

    expect(result.current.mensajeError).toBe(MENSAJE_PENDIENTE_NO_RECUPERABLE);
  });

  it('descarta la respuesta si la sesión cambió mientras se esperaba', async () => {
    const respuesta = diferida<ContratacionPlan>();
    vi.mocked(iniciarContratacion).mockReturnValue(respuesta.promesa);
    const { result } = montar();

    let operacion!: Promise<void>;
    act(() => {
      operacion = result.current.contratar();
    });
    sesion.marca = 2; // otra persona entró mientras esperábamos
    respuesta.resolver(contrato());
    await act(() => operacion);

    expect(result.current.contrato).toBeNull();
    expect(irAlCheckout).not.toHaveBeenCalled();
  });

  it('lee del plan si el Premium es de demostración', async () => {
    vi.mocked(getPlanes).mockResolvedValue([{ codigo: 'premium', precio_demo: false } as PlanDisponible]);
    const { result } = montar();

    await waitFor(() => expect(result.current.precioDemo).toBe(false));
  });

  it('si no puede leer el plan, no afirma nada sobre el cobro', async () => {
    vi.mocked(getPlanes).mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = montar();

    await act(async () => {});

    expect(result.current.precioDemo).toBeNull();
  });

  it('verificar consulta la contratación pendiente y vuelve a leer el plan', async () => {
    vi.mocked(iniciarContratacion).mockResolvedValue(contrato());
    vi.mocked(getContratacion).mockResolvedValue(contrato({ estado: 'exitosa' }));
    const { result } = montar();
    await act(() => result.current.contratar());

    await act(() => result.current.verificar());

    expect(getContratacion).toHaveBeenCalledWith('c-1');
    expect(result.current.contrato?.estado).toBe('exitosa');
    expect(alPlanCambiar).toHaveBeenCalled();
  });

  it('cancelar cierra la contratación pendiente y borra el intento guardado', async () => {
    vi.mocked(iniciarContratacion).mockResolvedValue(contrato());
    vi.mocked(cancelarContratacion).mockResolvedValue(contrato({ estado: 'cancelada' }));
    const { result } = montar();
    await act(() => result.current.contratar());

    await act(() => result.current.cancelar());

    expect(cancelarContratacion).toHaveBeenCalledWith('c-1');
    expect(result.current.contrato?.estado).toBe('cancelada');
    expect(window.localStorage.getItem(CLAVE_DEL_INTENTO)).toBeNull();
  });
});
