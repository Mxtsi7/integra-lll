// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

/**
 * Un backend de mentira CON memoria: lo que se marca como leída queda leída en las lecturas siguientes.
 * Como la pantalla vuelve a pedir la lista después de cada acción, un backend que siempre responde lo
 * mismo no representaría lo que de verdad pasa.
 */
function crearApi(cambios: Partial<ApiAlertas> = {}): ApiAlertas {
  let alertas = [crearAlerta('a1'), crearAlerta('a2', false)];
  const api: ApiAlertas = {
    getAlertas: vi.fn(async (consulta: { pagina?: number; lectura?: string } = {}) => {
      const visibles = consulta.lectura === 'pendiente' ? alertas.filter((alerta) => alerta.pendiente) : alertas;
      return pagina(visibles.map((alerta) => ({ ...alerta })));
    }) as unknown as ApiAlertas['getAlertas'],
    getContadorAlertas: vi.fn(async () => ({ pendientes: alertas.filter((alerta) => alerta.pendiente).length, total: alertas.length })),
    marcarAlertaLeida: vi.fn(async (id: string) => {
      alertas = alertas.map((alerta) => (alerta.id === id ? crearAlerta(id, false) : alerta));
      return crearAlerta(id, false);
    }),
    marcarTodasLasAlertasLeidas: vi.fn(async () => {
      const leidas = alertas.filter((alerta) => alerta.pendiente).length;
      alertas = alertas.map((alerta) => crearAlerta(alerta.id, false));
      return { leidas };
    }),
  };
  return { ...api, ...cambios };
}

/**
 * Un servidor falso que se comporta como FE-19/FE-20: filtra por lectura, pagina de a 10 y responde 404
 * si se pide una página que ya no existe. Con él se ve lo que pasa en "Sin leer" cuando se marcan alertas.
 */
function servidor(cuantas: number): ApiAlertas {
  const alertas = Array.from({ length: cuantas }, (_, i) => crearAlerta(`a${String(i + 1).padStart(2, '0')}`));
  return {
    getAlertas: vi.fn(async (consulta: { pagina?: number; lectura?: string } = {}) => {
      const { pagina: numero = 1, lectura } = consulta;
      const base = lectura === 'pendiente' ? alertas.filter((alerta) => alerta.pendiente) : alertas;
      const desde = (numero - 1) * 10;
      if (numero > 1 && desde >= base.length) throw Object.assign(new Error('Página inválida.'), { status: 404 });
      return {
        count: base.length,
        next: desde + 10 < base.length ? 'siguiente' : null,
        previous: null,
        results: base.slice(desde, desde + 10).map((alerta) => ({ ...alerta })),
      };
    }) as unknown as ApiAlertas['getAlertas'],
    getContadorAlertas: vi.fn(async () => ({ pendientes: alertas.filter((alerta) => alerta.pendiente).length, total: alertas.length })),
    marcarAlertaLeida: vi.fn(async (id: string) => {
      const alerta = alertas.find((otra) => otra.id === id)!;
      Object.assign(alerta, crearAlerta(id, false));
      return { ...alerta };
    }),
    marcarTodasLasAlertasLeidas: vi.fn(async () => ({ leidas: 0 })),
  };
}

async function abrirEnSinLeer(api: ApiAlertas) {
  render(<CentroAlertas api={api} />);
  await screen.findByTestId('alerta-a01');
  fireEvent.click(screen.getByTestId('filtro-sin-leer'));
  await screen.findByTestId('alerta-a01');
}

async function marcarYEsperar(id: string) {
  await act(async () => {
    fireEvent.click(screen.getByTestId(`marcar-leida-${id}`));
  });
  await waitFor(() => expect(screen.queryByTestId(`alerta-${id}`)).toBeNull());
}

/** Toca "Ver más alertas" hasta que ya no haya. Con 15 alertas basta con una o dos veces. */
async function verTodoLoQueHaya() {
  for (let vuelta = 0; vuelta < 5 && screen.queryByTestId('cargar-mas-alertas'); vuelta += 1) {
    await act(async () => {
      fireEvent.click(screen.getByTestId('cargar-mas-alertas'));
    });
  }
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
    const api = crearApi();
    const marcarReal = api.marcarAlertaLeida;
    let terminar: () => void = () => {};
    const marcarAlertaLeida = vi.fn(
      (id: string) => new Promise<Alerta>((resolver) => (terminar = () => resolver(marcarReal(id)))),
    );
    render(<CentroAlertas api={{ ...api, marcarAlertaLeida }} />);
    const boton = await screen.findByTestId('marcar-leida-a1');
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(marcarAlertaLeida).toHaveBeenCalledTimes(1);
    await act(async () => terminar());
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
    const api = servidor(12);
    render(<CentroAlertas api={api} />);
    fireEvent.click(await screen.findByTestId('cargar-mas-alertas'));
    expect(await screen.findByTestId('alerta-a12')).toBeTruthy();
    expect(api.getAlertas).toHaveBeenLastCalledWith({ pagina: 2 });
    expect(screen.getAllByTestId(/^alerta-a\d\d$/)).toHaveLength(12);
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

  it('una lectura que salió ANTES de marcar y llega DESPUÉS no devuelve la alerta a pendiente ni el contador viejo', async () => {
    const api = crearApi();
    const leerReal = api.getAlertas;
    let llamadas = 0;
    let soltarLecturaVieja: () => void = () => {};
    const getAlertas = vi.fn((consulta?: Parameters<ApiAlertas['getAlertas']>[0]) => {
      llamadas += 1;
      const instantanea = leerReal(consulta); // se toma ahora: a1 todavía pendiente
      if (llamadas !== 2) return instantanea;
      return new Promise((resolver) => (soltarLecturaVieja = () => void instantanea.then(resolver)));
    }) as unknown as ApiAlertas['getAlertas'];

    let avisarFoco: () => void = () => {};
    const alVolverAPantalla = (recargar: () => void) => {
      avisarFoco = recargar;
      return () => {};
    };
    render(<CentroAlertas api={{ ...api, getAlertas }} alVolverAPantalla={alVolverAPantalla} />);
    await screen.findByTestId('alerta-nueva-a1');

    await act(async () => avisarFoco()); // la lectura vieja queda en vuelo
    fireEvent.click(screen.getByTestId('marcar-leida-a1')); // el POST confirma
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer'));
    await act(async () => soltarLecturaVieja()); // ahora llega la lectura vieja

    expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('si se pasa de "Todas" a "Sin leer" mientras se marca, la alerta leída sale de la lista y el badge queda coherente', async () => {
    const api = crearApi();
    const marcarReal = api.marcarAlertaLeida;
    let confirmar: () => void = () => {};
    const marcarAlertaLeida = vi.fn((id: string) => new Promise<Alerta>((resolver) => (confirmar = () => resolver(marcarReal(id)))));
    render(<CentroAlertas api={{ ...api, marcarAlertaLeida }} />);

    fireEvent.click(await screen.findByTestId('marcar-leida-a1')); // POST en vuelo, en "Todas"
    fireEvent.click(screen.getByTestId('filtro-sin-leer'));
    await screen.findByTestId('alerta-a1'); // "Sin leer" todavía la muestra pendiente
    await act(async () => confirmar());

    await waitFor(() => expect(screen.queryByTestId('alerta-a1')).toBeNull());
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('si se pasa de "Sin leer" a "Todas" mientras se marca, la alerta queda a la vista como leída', async () => {
    const api = crearApi();
    const marcarReal = api.marcarAlertaLeida;
    let confirmar: () => void = () => {};
    const marcarAlertaLeida = vi.fn((id: string) => new Promise<Alerta>((resolver) => (confirmar = () => resolver(marcarReal(id)))));
    render(<CentroAlertas api={{ ...api, marcarAlertaLeida }} />);

    fireEvent.click(await screen.findByTestId('filtro-sin-leer'));
    fireEvent.click(await screen.findByTestId('marcar-leida-a1')); // POST en vuelo, en "Sin leer"
    fireEvent.click(screen.getByTestId('filtro-todas'));
    await screen.findByTestId('alerta-a2');
    await act(async () => confirmar());

    await waitFor(() => expect(screen.queryByTestId('alerta-nueva-a1')).toBeNull());
    expect(screen.getByTestId('alerta-a1')).toBeTruthy(); // en "Todas" la leída se queda
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('0 sin leer');
  });

  it('una lectura de "ver más" que salió antes de marcar no restaura la alerta', async () => {
    const api = servidor(15);
    const leerReal = api.getAlertas;
    let soltarPagina2: () => void = () => {};
    const getAlertas = vi.fn((consulta?: Parameters<ApiAlertas['getAlertas']>[0]) => {
      if (consulta?.pagina !== 2) return leerReal(consulta);
      const instantanea = leerReal(consulta); // se toma ahora: a01 todavía pendiente
      return new Promise((resolver) => (soltarPagina2 = () => void instantanea.then(resolver)));
    }) as unknown as ApiAlertas['getAlertas'];
    render(<CentroAlertas api={{ ...api, getAlertas }} />);

    fireEvent.click(await screen.findByTestId('cargar-mas-alertas'));
    fireEvent.click(screen.getByTestId('marcar-leida-a01'));
    await waitFor(() => expect(screen.getByTestId('badge-pendientes').textContent).toBe('14 sin leer'));
    await act(async () => soltarPagina2());

    expect(screen.queryByTestId('alerta-nueva-a01')).toBeNull();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('14 sin leer');
  });
});

describe('"Sin leer" + "Ver más" contra un servidor que filtra y pagina (revisión de #199)', () => {
  it('A: 15 pendientes, marco 3 y pido más: no se salta ninguna', async () => {
    await abrirEnSinLeer(servidor(15));
    for (const id of ['a01', 'a02', 'a03']) await marcarYEsperar(id);
    await verTodoLoQueHaya();

    await screen.findByTestId('alerta-a15');
    for (const id of ['a04', 'a05', 'a06', 'a07', 'a08', 'a09', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15']) {
      expect(screen.queryByTestId(`alerta-${id}`)).toBeTruthy();
    }
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('12 sin leer');
  });

  it('B: 11 pendientes, marco 1 y pido más: aparece a11 y no queda un error del que no se sale', async () => {
    await abrirEnSinLeer(servidor(11));
    await marcarYEsperar('a01');
    await verTodoLoQueHaya();

    await waitFor(() => expect(screen.queryByTestId('alerta-a11')).toBeTruthy());
    expect(screen.queryByTestId('error-alertas')).toBeNull();
  });

  it('un 404 al pedir más significa que no hay más: no muestra error y quita el botón', async () => {
    const api = servidor(11);
    const leerReal = api.getAlertas;
    // El conjunto se achicó entre que se mostró el botón y el toque: la página 2 ya no existe.
    const getAlertas = vi.fn((consulta?: Parameters<ApiAlertas['getAlertas']>[0]) =>
      consulta?.pagina === 2 ? Promise.reject(Object.assign(new Error('Página inválida.'), { status: 404 })) : leerReal(consulta),
    ) as unknown as ApiAlertas['getAlertas'];
    render(<CentroAlertas api={{ ...api, getAlertas }} />);

    const botonVerMas = await screen.findByTestId('cargar-mas-alertas');
    await act(async () => {
      fireEvent.click(botonVerMas);
    });

    await waitFor(() => expect(screen.queryByTestId('cargar-mas-alertas')).toBeNull());
    expect(screen.queryByTestId('error-alertas')).toBeNull();
  });

  it('un error distinto de 404 al pedir más sí se avisa y el botón sigue para reintentar', async () => {
    const api = servidor(11);
    const leerReal = api.getAlertas;
    const getAlertas = vi.fn((consulta?: Parameters<ApiAlertas['getAlertas']>[0]) =>
      consulta?.pagina === 2 ? Promise.reject(new Error('500')) : leerReal(consulta),
    ) as unknown as ApiAlertas['getAlertas'];
    render(<CentroAlertas api={{ ...api, getAlertas }} />);

    const botonVerMas = await screen.findByTestId('cargar-mas-alertas');
    await act(async () => {
      fireEvent.click(botonVerMas);
    });

    expect(await screen.findByTestId('error-alertas')).toBeTruthy();
    expect(screen.getByTestId('cargar-mas-alertas')).toBeTruthy();
  });

  it('C: 15 pendientes, marco las 10 visibles: no dice que no hay sin leer mientras queden', async () => {
    await abrirEnSinLeer(servidor(15));
    for (let i = 1; i <= 10; i += 1) await marcarYEsperar(`a${String(i).padStart(2, '0')}`);

    expect(screen.queryByText('No tienes alertas sin leer')).toBeNull();
    await verTodoLoQueHaya();
    expect(screen.queryByTestId('alerta-a15')).toBeTruthy();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('5 sin leer');
  });

  it('con "Ver más" disponible y la lista vacía, no muestra el vacío: faltan alertas por traer', async () => {
    const api = crearApi({
      getAlertas: vi.fn().mockResolvedValue(pagina([], true)),
      getContadorAlertas: vi.fn().mockResolvedValue({ pendientes: 5, total: 5 }),
    });
    render(<CentroAlertas api={api} />);

    expect(await screen.findByTestId('cargar-mas-alertas')).toBeTruthy();
    expect(screen.queryByText('No tienes alertas')).toBeNull();
    expect(screen.getByTestId('badge-pendientes').textContent).toBe('5 sin leer');
  });
});
