// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Alerta } from '@ojoalgasto/shared';
import { CentroAlertas } from './CentroAlertas';
import type { ApiAlertas } from './useAlertas';

function crearAlerta(id: string, pendiente = true): Alerta {
  return {
    id,
    tipo: 'proximo_cobro',
    tipo_legible: 'Próximo cobro',
    titulo: `Alerta ${id}`,
    mensaje: `Mensaje ${id}`,
    suscripcion_id: null,
    datos: {},
    lectura: pendiente ? 'pendiente' : 'leida',
    lectura_legible: pendiente ? 'Pendiente' : 'Leída',
    pendiente,
    leida_en: null,
    revisada_en: null,
    creado_en: '2026-11-01T10:00:00Z',
  };
}

function pagina(alertas: Alerta[], haySiguiente = false) {
  return { count: alertas.length, next: haySiguiente ? 'siguiente' : null, previous: null, results: alertas };
}

function crearApi(cambios: Partial<ApiAlertas> = {}): ApiAlertas {
  return {
    getAlertas: vi.fn().mockResolvedValue(pagina([crearAlerta('a1'), crearAlerta('a2', false)])),
    getContadorAlertas: vi.fn().mockResolvedValue({ pendientes: 1, total: 2 }),
    marcarAlertaLeida: vi.fn().mockResolvedValue(crearAlerta('a1', false)),
    marcarTodasLasAlertasLeidas: vi.fn().mockResolvedValue({ leidas: 1 }),
    ...cambios,
  };
}

afterEach(() => {
  cleanup();
});

describe('Centro de alertas móvil (AN-10 y AN-24)', () => {
  it('muestra las alertas y el badge con los pendientes del backend', async () => {
    render(<CentroAlertas api={crearApi()} />);
    expect(await screen.findByTestId('alerta-a1')).toBeTruthy();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('1 sin leer');
    expect(screen.getByTestId('alerta-nueva-a1')).toBeTruthy();
    expect(screen.queryByTestId('alerta-nueva-a2')).toBeNull();
    expect(screen.queryByTestId('marcar-leida-a2')).toBeNull();
  });

  it('sin alertas muestra el estado vacío', async () => {
    const api = crearApi({ getAlertas: vi.fn().mockResolvedValue(pagina([])), getContadorAlertas: vi.fn().mockResolvedValue({ pendientes: 0, total: 0 }) });
    render(<CentroAlertas api={api} />);
    expect(await screen.findByText('No tienes alertas')).toBeTruthy();
  });

  it('si falla la carga muestra error y reintentar vuelve a pedir', async () => {
    const getAlertas = vi.fn().mockRejectedValueOnce(new Error('sin red')).mockResolvedValue(pagina([crearAlerta('a1')]));
    render(<CentroAlertas api={crearApi({ getAlertas })} />);
    const botonReintentar = await screen.findByRole('button', { name: /reintentar/i });
    fireEvent.click(botonReintentar);
    expect(await screen.findByTestId('alerta-a1')).toBeTruthy();
  });

  it('marcar como leída actualiza la alerta y baja el badge', async () => {
    const api = crearApi();
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('marcar-leida-a1'));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));
    expect(api.marcarAlertaLeida).toHaveBeenCalledWith('a1');
    expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull();
  });

  it('un doble toque manda una sola petición', async () => {
    let terminar: (alerta: Alerta) => void = () => {};
    const marcarAlertaLeida = vi.fn().mockReturnValue(new Promise<Alerta>((resolver) => (terminar = resolver)));
    render(<CentroAlertas api={crearApi({ marcarAlertaLeida })} />);
    const boton = await screen.findByTestId('marcar-leida-a1');
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(marcarAlertaLeida).toHaveBeenCalledTimes(1);
    terminar(crearAlerta('a1', false));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));
  });

  it('si el contador ya estaba en 0, marcar una alerta no lo deja en negativo', async () => {
    // Dato desfasado: la lista aún muestra a1 como pendiente pero el backend ya contaba 0.
    const api = crearApi({ getContadorAlertas: vi.fn().mockResolvedValue({ pendientes: 0, total: 2 }) });
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('marcar-leida-a1'));
    await waitFor(() => expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull());
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('si falla marcar como leída, avisa y deja la alerta pendiente', async () => {
    const api = crearApi({ marcarAlertaLeida: vi.fn().mockRejectedValue(new Error('500')) });
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('marcar-leida-a1'));
    expect(await screen.findByTestId('error-alertas')).toBeTruthy();
    expect(screen.getByTestId('alerta-nueva-a1')).toBeTruthy();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('1 sin leer');
  });

  it('marcar todas como leídas vuelve a cargar desde el backend', async () => {
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1')]))
      .mockResolvedValue(pagina([crearAlerta('a1', false)]));
    const getContadorAlertas = vi
      .fn()
      .mockResolvedValueOnce({ pendientes: 1, total: 1 })
      .mockResolvedValue({ pendientes: 0, total: 1 });
    const api = crearApi({ getAlertas, getContadorAlertas });
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('marcar-todas-leidas'));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));
    expect(api.marcarTodasLasAlertasLeidas).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('marcar-todas-leidas')).toBeNull();
  });

  it('"Ver más alertas" pide la página 2 y no repite alertas ya mostradas', async () => {
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1'), crearAlerta('a2')], true))
      .mockResolvedValueOnce(pagina([crearAlerta('a2'), crearAlerta('a3')], false));
    render(<CentroAlertas api={crearApi({ getAlertas })} />);
    fireEvent.click(await screen.findByTestId('cargar-mas-alertas'));
    expect(await screen.findByTestId('alerta-a3')).toBeTruthy();
    expect(getAlertas).toHaveBeenLastCalledWith({ pagina: 2 });
    expect(screen.getAllByTestId('alerta-a2')).toHaveLength(1);
    expect(screen.queryByTestId('cargar-mas-alertas')).toBeNull();
  });

  it('una respuesta tardía tras salir de la pantalla no falla ni actualiza nada', async () => {
    let responder: (valor: ReturnType<typeof pagina>) => void = () => {};
    const getAlertas = vi.fn().mockReturnValue(new Promise((resolver) => (responder = resolver)));
    const { unmount } = render(<CentroAlertas api={crearApi({ getAlertas })} />);
    unmount();
    responder(pagina([crearAlerta('a1')]));
    await Promise.resolve();
    expect(screen.queryByTestId('alerta-a1')).toBeNull();
  });

  it('el filtro "Sin leer" pide solo las pendientes y "Todas" vuelve a pedir todas', async () => {
    const api = crearApi();
    render(<CentroAlertas api={api} />);
    await screen.findByTestId('alerta-a1');

    fireEvent.click(screen.getByTestId('filtro-sin-leer'));
    await waitFor(() => expect(api.getAlertas).toHaveBeenLastCalledWith({ pagina: 1, lectura: 'pendiente' }));
    fireEvent.click(screen.getByTestId('filtro-todas'));
    await waitFor(() => expect(api.getAlertas).toHaveBeenLastCalledWith({ pagina: 1 }));
  });

  it('con "Sin leer", una alerta marcada como leída sale de la lista', async () => {
    const api = crearApi({ getAlertas: vi.fn().mockResolvedValue(pagina([crearAlerta('a1')])) });
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('filtro-sin-leer'));
    fireEvent.click(await screen.findByTestId('marcar-leida-a1'));
    await waitFor(() => expect(screen.queryByTestId('alerta-a1')).toBeNull());
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('si un filtro no tiene alertas, los filtros siguen a la vista para volver a "Todas"', async () => {
    const getAlertas = vi.fn().mockResolvedValue(pagina([]));
    render(<CentroAlertas api={crearApi({ getAlertas })} />);
    fireEvent.click(await screen.findByTestId('filtro-sin-leer'));
    expect(await screen.findByText('No tienes alertas sin leer')).toBeTruthy();
    expect(screen.getByTestId('filtro-todas')).toBeTruthy();
  });

  it('al volver a la pantalla se vuelve a pedir y no reaparece una alerta ya leída', async () => {
    let avisarFoco: () => void = () => {};
    const alVolverAPantalla = (recargar: () => void) => {
      avisarFoco = recargar;
      return () => {};
    };
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1')]))
      .mockResolvedValue(pagina([crearAlerta('a1', false)]));
    const getContadorAlertas = vi
      .fn()
      .mockResolvedValueOnce({ pendientes: 1, total: 1 })
      .mockResolvedValue({ pendientes: 0, total: 1 });
    render(<CentroAlertas api={crearApi({ getAlertas, getContadorAlertas })} alVolverAPantalla={alVolverAPantalla} />);
    await screen.findByTestId('alerta-nueva-a1');

    avisarFoco();

    await waitFor(() => expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull());
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('un GET en segundo plano iniciado antes del marcado no restaura la alerta leída ni el contador viejo, pero conserva alertas nuevas', async () => {
    let avisarFoco: () => void = () => {};
    const alVolverAPantalla = (recargar: () => void) => {
      avisarFoco = recargar;
      return () => {};
    };

    let resolverGetSegundoPlano!: (valor: ReturnType<typeof pagina>) => void;
    let resolverContadorSegundoPlano!: (valor: { pendientes: number; total: number }) => void;
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true)]))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof pagina>>((res) => {
            resolverGetSegundoPlano = res;
          }),
      );
    const getContadorAlertas = vi
      .fn()
      .mockResolvedValueOnce({ pendientes: 1, total: 1 })
      .mockImplementationOnce(
        () =>
          new Promise<{ pendientes: number; total: number }>((res) => {
            resolverContadorSegundoPlano = res;
          }),
      );

    render(<CentroAlertas api={crearApi({ getAlertas, getContadorAlertas })} alVolverAPantalla={alVolverAPantalla} />);
    await screen.findByTestId('alerta-nueva-a1');

    // 1. Foco dispara GET A en segundo plano y queda pendiente.
    avisarFoco();
    expect(getAlertas).toHaveBeenCalledTimes(2);

    // 2. Mientras GET A está en vuelo, el usuario marca a1 como leída.
    fireEvent.click(screen.getByTestId('marcar-leida-a1'));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));
    expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull();

    // 3. GET A resuelve con la instantánea vieja (a1 pendiente) más una alerta nueva a2 pendiente.
    resolverGetSegundoPlano(pagina([crearAlerta('a2', true), crearAlerta('a1', true)]));
    resolverContadorSegundoPlano({ pendientes: 2, total: 2 });

    await waitFor(() => expect(screen.getByTestId('alerta-a2')).toBeTruthy());
    // a1 sigue leída y el badge refleja solo a2 (1 sin leer, no 2).
    expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('1 sin leer');
  });

  it('páginas en vuelo y marcar todas reconcilian lecturas anteriores sin restaurar pendientes', async () => {
    let resolverPagina2!: (valor: ReturnType<typeof pagina>) => void;
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true)], true))
      .mockImplementationOnce(
        () =>
          new Promise<ReturnType<typeof pagina>>((res) => {
            resolverPagina2 = res;
          }),
      )
      .mockResolvedValueOnce(pagina([crearAlerta('a1', false), crearAlerta('a2', false)]));
    const getContadorAlertas = vi
      .fn()
      .mockResolvedValueOnce({ pendientes: 2, total: 2 })
      .mockResolvedValue({ pendientes: 0, total: 2 });

    render(<CentroAlertas api={crearApi({ getAlertas, getContadorAlertas })} />);
    await screen.findByTestId('alerta-a1');

    // 1. Inicia carga de página 2 (en vuelo).
    fireEvent.click(screen.getByTestId('cargar-mas-alertas'));
    expect(getAlertas).toHaveBeenCalledWith({ pagina: 2 });

    // 2. Marca todas como leídas antes de que resuelva página 2.
    fireEvent.click(screen.getByTestId('marcar-todas-leidas'));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));

    // 3. Resuelve página 2 con a2 todavía pendiente en la instantánea vieja.
    resolverPagina2(pagina([crearAlerta('a2', true)], false));
    await waitFor(() => expect(screen.getByTestId('alerta-a2')).toBeTruthy());
    expect(screen.queryByTestId('alerta-nueva-a2')).toBeNull();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('al cambiar de "Todas" a "Sin leer" durante el POST, la alerta desaparece al confirmarse y el badge queda coherente', async () => {
    let resolverPost!: (alerta: Alerta) => void;
    const marcarAlertaLeida = vi.fn().mockImplementation(
      () =>
        new Promise<Alerta>((res) => {
          resolverPost = res;
        }),
    );
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true), crearAlerta('a2', false)]))
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true)]));

    render(<CentroAlertas api={crearApi({ getAlertas, marcarAlertaLeida })} />);
    await screen.findByTestId('alerta-a1');

    // 1. Inicia POST en "Todas" y queda pendiente.
    fireEvent.click(screen.getByTestId('marcar-leida-a1'));
    expect(marcarAlertaLeida).toHaveBeenCalledTimes(1);

    // 2. Cambia a "Sin leer"; su GET devuelve a1 todavía pendiente.
    fireEvent.click(screen.getByTestId('filtro-sin-leer'));
    await waitFor(() => expect(getAlertas).toHaveBeenLastCalledWith({ pagina: 1, lectura: 'pendiente' }));
    expect(await screen.findByTestId('alerta-a1')).toBeTruthy();

    // 3. Resuelve el POST: debe aplicar el filtro vigente ("Sin leer") y quitar a1 de la lista.
    resolverPost(crearAlerta('a1', false));
    await waitFor(() => expect(screen.queryByTestId('alerta-a1')).toBeNull());
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('al cambiar de "Sin leer" a "Todas" durante el POST y al desmontar, aplica el filtro vigente y no falla al salir', async () => {
    let resolverPost!: (alerta: Alerta) => void;
    const marcarAlertaLeida = vi.fn().mockImplementation(
      () =>
        new Promise<Alerta>((res) => {
          resolverPost = res;
        }),
    );
    const getAlertas = vi
      .fn()
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true)]))
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true)]))
      .mockResolvedValueOnce(pagina([crearAlerta('a1', true), crearAlerta('a2', false)]));

    const { unmount } = render(<CentroAlertas api={crearApi({ getAlertas, marcarAlertaLeida })} />);
    fireEvent.click(await screen.findByTestId('filtro-sin-leer'));
    await screen.findByTestId('alerta-a1');

    // 1. Inicia POST en "Sin leer" y cambia a "Todas".
    fireEvent.click(screen.getByTestId('marcar-leida-a1'));
    fireEvent.click(screen.getByTestId('filtro-todas'));
    await waitFor(() => expect(getAlertas).toHaveBeenLastCalledWith({ pagina: 1 }));
    await screen.findByTestId('alerta-a2');

    // 2. Resuelve POST: en "Todas", a1 permanece visible como leída y baja el badge.
    resolverPost(crearAlerta('a1', false));
    await waitFor(() => expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull());
    expect(screen.getByTestId('alerta-a1')).toBeTruthy();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');

    // 3. Cierre/desmontaje durante otro POST pendiente no provoca errores.
    let resolverPostSalida!: (alerta: Alerta) => void;
    marcarAlertaLeida.mockImplementationOnce(
      () =>
        new Promise<Alerta>((res) => {
          resolverPostSalida = res;
        }),
    );
    const apiSalida = crearApi({
      getAlertas: vi.fn().mockResolvedValue(pagina([crearAlerta('a3', true)])),
      marcarAlertaLeida,
    });
    unmount();
    const vista2 = render(<CentroAlertas api={apiSalida} />);
    fireEvent.click(await vista2.findByTestId('marcar-leida-a3'));
    vista2.unmount();
    resolverPostSalida(crearAlerta('a3', false));
    await Promise.resolve();
  });
});
