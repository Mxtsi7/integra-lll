// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidatoDetectado } from '@ojoalgasto/shared';
import { ErrorDeApi, pedir } from '../../../../shared/src/api/cliente';
import { guardarTokens } from '../../../../shared/src/auth';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { useConfirmacionCandidatos } from '../../hooks/useConfirmacionCandidatos';
import { useSeleccionCandidatos } from '../../hooks/useSeleccionCandidatos';
import { candidatoDePrueba, paginaDeCandidatosDePrueba } from '../../test/candidatosDePrueba';
import { crearTokenDePrueba } from '../../test/tokensDePrueba';
import type { CargaCandidatos } from './cargaCandidatos';
import type { ConfirmacionDeCandidatos, ResultadoConfirmacion } from './confirmacionCandidatos';
import { ListaCandidatos } from './ListaCandidatos';
import type { SeleccionDeCandidatos } from './seleccionCandidatos';

// Solo se simula la red (pedir). La lista, la selección y la confirmación son las reales.
vi.mock('../../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const SPOTIFY = candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' });
const NETFLIX = candidatoDePrueba({ id: 'c-2', servicio: 'Netflix', importe: '8990.00' });
const SIN_PROVEEDOR = candidatoDePrueba({ id: 'c-3', servicio: null, servicio_texto: 'PAGO 4471', servicio_resultado: 'desconocido' });
const HBO = candidatoDePrueba({ id: 'c-4', servicio: 'HBO Max' });

const conLosCobros = (...cobros: CandidatoDetectado[]): CargaCandidatos =>
  ({ tipo: 'listo', datos: paginaDeCandidatosDePrueba({ count: cobros.length, results: cobros }) });
const confirmado = (cobro: CandidatoDetectado): CandidatoDetectado => ({
  ...cobro,
  estado: 'confirmado',
  estado_legible: 'Confirmado',
  aplicacion: 'pendiente',
});

const botonConfirmar = () => screen.getByRole('button', { name: /^Confirm(ar|ando)/ });
const casillaDe = (cobro: CandidatoDetectado) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Seleccionar ${cobro.servicio ?? cobro.servicio_texto},`) });
const casillaDeLaPagina = () => screen.getByRole('checkbox', { name: 'Seleccionar todos los de esta página' });
const lista = () => screen.getByRole('region', { name: 'Cobros encontrados' });
const resultadoDeConfirmar = () => screen.getByLabelText('Resultado de la confirmación');
const itemDe = (nombre: string) => within(lista()).getByText(nombre).closest('li') as HTMLElement;

afterEach(() => {
  cleanup();
});

describe('el botón Confirmar y su resultado, con una confirmación inventada (S3-CH-08)', () => {
  const seleccionConIds = (ids: string[], idsParaConfirmar = ids, cantidadSeleccionable = 4): SeleccionDeCandidatos => ({
    seleccionados: new Set(ids),
    idsParaConfirmar,
    cantidadSeleccionable,
    alAlternar: vi.fn(),
    alAlternarPagina: vi.fn(),
    alLimpiar: vi.fn(),
  });
  const confirmacionFalsa = (parcial: Partial<ConfirmacionDeCandidatos> = {}): ConfirmacionDeCandidatos => ({
    enCurso: false,
    resultado: null,
    alConfirmar: vi.fn(),
    alCerrarResultado: vi.fn(),
    ...parcial,
  });
  const montar = ({
    seleccion = seleccionConIds([]),
    confirmacion = confirmacionFalsa(),
    carga = conLosCobros(SPOTIFY, NETFLIX, SIN_PROVEEDOR, HBO),
  }: { seleccion?: SeleccionDeCandidatos; confirmacion?: ConfirmacionDeCandidatos | null; carga?: CargaCandidatos } = {}) =>
    render(
      <ListaCandidatos
        carga={carga}
        pagina={1}
        alCambiarPagina={() => {}}
        alReintentar={() => {}}
        seleccion={seleccion}
        confirmacion={confirmacion ?? undefined}
      />,
    );

  it('sin la confirmación no hay botón, aunque haya selección', () => {
    montar({ seleccion: seleccionConIds(['c-1']), confirmacion: null });

    expect(screen.queryByRole('button', { name: /^Confirmar/ })).not.toBeInTheDocument();
  });

  it('sin nada seleccionado el botón está deshabilitado', () => {
    montar();

    expect(botonConfirmar()).toBeDisabled();
    expect(botonConfirmar()).toHaveTextContent('Confirmar');
  });

  it.each([
    [['c-1'], '1 cobro'],
    [['c-1', 'c-2'], '2 cobros'],
  ])('con %j seleccionados dice cuántos cobros confirma', (ids, texto) => {
    montar({ seleccion: seleccionConIds(ids) });

    expect(botonConfirmar()).toBeEnabled();
    expect(botonConfirmar()).toHaveTextContent(`Confirmar ${texto}`);
  });

  it('solo cuentan los que se pueden confirmar: uno sin proveedor se puede rechazar pero no entra', () => {
    montar({ seleccion: seleccionConIds(['c-1', 'c-3'], ['c-1']) });

    expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');
  });

  it('con solo cobros sin proveedor seleccionados no hay nada que confirmar', () => {
    montar({ seleccion: seleccionConIds(['c-3'], []) });

    expect(botonConfirmar()).toBeDisabled();
  });

  it('al pulsarlo pide confirmar una vez y el foco queda en la lista', () => {
    const confirmacion = confirmacionFalsa();
    montar({ seleccion: seleccionConIds(['c-1']), confirmacion });

    fireEvent.click(botonConfirmar());

    expect(confirmacion.alConfirmar).toHaveBeenCalledTimes(1);
    expect(lista()).toHaveFocus();
  });

  it('mientras confirma el botón lo dice y no se puede volver a pulsar, ni limpiar la selección', () => {
    montar({ seleccion: seleccionConIds(['c-1']), confirmacion: confirmacionFalsa({ enCurso: true }) });

    expect(botonConfirmar()).toHaveTextContent('Confirmando…');
    expect(botonConfirmar()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Limpiar selección' })).toBeDisabled();
  });

  describe('el resultado por cobro', () => {
    const resultado = (...resultados: ResultadoConfirmacion['resultados'][number][]): ResultadoConfirmacion => ({ resultados });
    const correcto = (id: string, nombre: string) => ({ id, nombre, tipo: 'confirmado' as const });
    const fallido = (id: string, nombre: string, mensaje: string) => ({ id, nombre, tipo: 'fallido' as const, mensaje });

    it('si todos se confirmaron lo dice y aclara que la orden queda pendiente de aplicar', () => {
      montar({ confirmacion: confirmacionFalsa({ resultado: resultado(correcto('c-1', 'Spotify'), correcto('c-2', 'Netflix')) }) });

      const aviso = resultadoDeConfirmar();
      expect(aviso).toHaveAttribute('role', 'status');
      expect(aviso).toHaveTextContent('Confirmaste 2 cobros.');
      expect(aviso).toHaveTextContent('Quedaron pendientes de aplicar: todavía no hay suscripción ni cobro creados.');
      expect(aviso).toHaveTextContent('Spotify: confirmado');
      expect(aviso).toHaveTextContent('Netflix: confirmado');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('de uno solo, en singular', () => {
      montar({ confirmacion: confirmacionFalsa({ resultado: resultado(correcto('c-1', 'Spotify')) }) });

      expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
    });

    it('con fallos parciales avisa como alerta y dice qué pasó con cada cobro', () => {
      montar({
        confirmacion: confirmacionFalsa({
          resultado: resultado(correcto('c-1', 'Spotify'), fallido('c-2', 'Netflix', 'Está rechazado. Para confirmarlo hay que volver a importar el archivo.')),
        }),
      });

      const alerta = screen.getByRole('alert');
      expect(alerta).toBe(resultadoDeConfirmar());
      expect(alerta).toHaveTextContent('Confirmaste 1 de 2 cobros; el resto no se pudo.');
      expect(alerta).toHaveTextContent('Spotify: confirmado');
      expect(alerta).toHaveTextContent('Netflix: Está rechazado. Para confirmarlo hay que volver a importar el archivo.');
    });

    it.each([
      [[fallido('c-1', 'Spotify', 'x'), fallido('c-2', 'Netflix', 'y')], 'No se pudo confirmar ningún cobro.'],
      [[fallido('c-1', 'Spotify', 'x')], 'No se pudo confirmar el cobro.'],
    ])('si ninguno se confirmó no dice que se confirmó nada', (resultados, texto) => {
      montar({ confirmacion: confirmacionFalsa({ resultado: resultado(...resultados) }) });

      const alerta = screen.getByRole('alert');
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).not.toHaveTextContent('Confirmaste');
      expect(alerta).not.toHaveTextContent('pendientes de aplicar');
    });

    it('Cerrar avisa que se cierra y el foco queda en la lista', () => {
      const confirmacion = confirmacionFalsa({ resultado: resultado(correcto('c-1', 'Spotify')) });
      montar({ confirmacion });

      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      expect(confirmacion.alCerrarResultado).toHaveBeenCalledTimes(1);
      expect(lista()).toHaveFocus();
    });

    it('se ve aunque ya no quede ningún cobro por decidir: la barra de selección no aparece, el resultado sí', () => {
      montar({
        carga: conLosCobros(confirmado(SPOTIFY)),
        seleccion: seleccionConIds([], [], 0),
        confirmacion: confirmacionFalsa({ resultado: resultado(correcto('c-1', 'Spotify')) }),
      });

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
    });

    it('se ve mientras la lista se recarga, que es justo lo que pasa después de confirmar', () => {
      montar({ carga: { tipo: 'cargando' }, confirmacion: confirmacionFalsa({ resultado: resultado(correcto('c-1', 'Spotify')) }) });

      expect(screen.getByText('Confirmaste 1 cobro.', { exact: false })).toBeInTheDocument();
      expect(lista()).toHaveAttribute('aria-busy', 'true');
    });

    it('sin resultado no hay recuadro', () => {
      montar();

      expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
    });
  });
});

describe('seleccionar y confirmar de punta a punta, con la API simulada (S3-CH-07 y S3-CH-08)', () => {
  const TOKEN = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
  const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

  /** Lo que el servidor tiene confirmado, y qué cobros responden con un error. */
  let confirmadosEnElServidor: Set<string>;
  let fallos: Partial<Record<string, Error>>;
  let pendientes: Partial<Record<string, Promise<unknown>>>;

  beforeEach(() => {
    localStorage.clear();
    guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
    confirmadosEnElServidor = new Set();
    fallos = {};
    pendientes = {};
    vi.mocked(pedir).mockReset().mockImplementation((ruta: string) => {
      const id = /^\/candidatos\/([^/]+)\/confirmar\/$/.exec(ruta)?.[1];
      if (id === undefined) return Promise.resolve(PERSONA_ACTUAL);
      if (fallos[id]) return Promise.reject(fallos[id]);
      if (pendientes[id]) return pendientes[id];
      confirmadosEnElServidor.add(id);
      return Promise.resolve({ id, estado: 'confirmado', aplicacion: 'pendiente' });
    });
  });

  const confirmaciones = () => vi.mocked(pedir).mock.calls.filter(([ruta]) => /\/confirmar\/$/.test(String(ruta))).map(([ruta]) => String(ruta));

  function Proveedores({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    );
  }

  /** La lista de verdad con sus dos hooks. Recargar vuelve a leer lo que el servidor tiene confirmado. */
  function ListaCompleta({ cobros }: { cobros: CandidatoDetectado[] }) {
    const leerDelServidor = (): CargaCandidatos =>
      conLosCobros(...cobros.map((cobro) => (confirmadosEnElServidor.has(cobro.id) ? confirmado(cobro) : cobro)));
    const [carga, setCarga] = useState<CargaCandidatos>(() => conLosCobros(...cobros));
    const candidatos = carga.tipo === 'listo' ? carga.datos.results : null;
    const seleccion = useSeleccionCandidatos(candidatos);
    const { enCurso, resultado, confirmar, cerrarResultado } = useConfirmacionCandidatos({ alTerminar: () => setCarga(leerDelServidor()) });
    const alConfirmar = () => {
      const porConfirmar = (candidatos ?? []).filter((cobro) => seleccion.idsParaConfirmar.includes(cobro.id));
      void confirmar(porConfirmar);
    };
    return (
      <ListaCandidatos
        carga={carga}
        pagina={1}
        alCambiarPagina={() => {}}
        alReintentar={() => {}}
        seleccion={seleccion}
        confirmacion={{ enCurso, resultado, alConfirmar, alCerrarResultado: cerrarResultado }}
      />
    );
  }

  const montar = async (cobros: CandidatoDetectado[]) => {
    render(<ListaCompleta cobros={cobros} />, { wrapper: Proveedores });
    await act(async () => {});
  };

  it('manda solo los cobros seleccionados, y al terminar esos quedan confirmados y los demás siguen pendientes', async () => {
    await montar([SPOTIFY, NETFLIX, HBO]);
    fireEvent.click(casillaDe(SPOTIFY));
    fireEvent.click(casillaDe(NETFLIX));

    await act(async () => fireEvent.click(botonConfirmar()));

    expect(confirmaciones()).toEqual(['/candidatos/c-1/confirmar/', '/candidatos/c-2/confirmar/']);
    expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 2 cobros.');
    // La lista se volvió a leer: los dos pasaron a confirmados, sin casilla, y la selección quedó vacía.
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
    expect(within(itemDe('Spotify')).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(itemDe('Spotify')).toHaveTextContent('orden pendiente de aplicar');
    expect(itemDe('HBO Max')).toHaveTextContent('Propuesto');
    expect(casillaDe(HBO)).not.toBeChecked();
    expect(botonConfirmar()).toBeDisabled();
  });

  it('un cobro sin proveedor reconocido no se manda aunque se seleccione toda la página', async () => {
    await montar([SPOTIFY, SIN_PROVEEDOR]);
    fireEvent.click(casillaDeLaPagina());
    expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');

    await act(async () => fireEvent.click(botonConfirmar()));

    expect(confirmaciones()).toEqual(['/candidatos/c-1/confirmar/']);
    expect(itemDe('PAGO 4471')).toHaveTextContent('Propuesto');
  });

  it('nada se marca confirmado hasta que el servidor responde, y el botón no deja confirmar otra vez mientras tanto', async () => {
    let responder!: (valor: unknown) => void;
    pendientes['c-1'] = new Promise((alResponder) => {
      responder = alResponder;
    });
    await montar([SPOTIFY]);
    fireEvent.click(casillaDe(SPOTIFY));

    await act(async () => fireEvent.click(botonConfirmar()));

    expect(botonConfirmar()).toHaveTextContent('Confirmando…');
    expect(botonConfirmar()).toBeDisabled();
    expect(itemDe('Spotify')).toHaveTextContent('Propuesto');
    expect(screen.queryByLabelText('Resultado de la confirmación')).not.toBeInTheDocument();

    await act(async () => {
      confirmadosEnElServidor.add('c-1');
      responder({ id: 'c-1', estado: 'confirmado' });
    });
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
  });

  it('un doble clic seguido manda una sola confirmación por cobro', async () => {
    let responder!: (valor: unknown) => void;
    pendientes['c-1'] = new Promise((alResponder) => {
      responder = alResponder;
    });
    await montar([SPOTIFY]);
    fireEvent.click(casillaDe(SPOTIFY));

    await act(async () => {
      fireEvent.click(botonConfirmar());
      fireEvent.click(botonConfirmar());
    });

    expect(confirmaciones()).toEqual(['/candidatos/c-1/confirmar/']);
    await act(async () => responder({ id: 'c-1' }));
  });

  it('con un fallo parcial el que falló sigue pendiente y seleccionado: se puede reintentar sin volver a elegirlo', async () => {
    fallos['c-2'] = new ErrorDeApi('Error interno.', 500);
    await montar([SPOTIFY, NETFLIX]);
    fireEvent.click(casillaDeLaPagina());

    await act(async () => fireEvent.click(botonConfirmar()));

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Confirmaste 1 de 2 cobros; el resto no se pudo.');
    expect(alerta).toHaveTextContent('Netflix: No se pudo confirmar. Inténtalo de nuevo.');
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
    expect(itemDe('Netflix')).toHaveTextContent('Propuesto');
    expect(casillaDe(NETFLIX)).toBeChecked();
    expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');

    delete fallos['c-2'];
    await act(async () => fireEvent.click(botonConfirmar()));

    expect(confirmaciones().filter((ruta) => ruta === '/candidatos/c-2/confirmar/')).toHaveLength(2);
    expect(itemDe('Netflix')).toHaveTextContent('Confirmado');
    expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
  });

  it('un 409 dice el motivo del servidor para ese cobro y no le quita la selección a los demás', async () => {
    fallos['c-1'] = new ErrorDeApi('Texto técnico.', 409, { codigo: ['candidato_rechazado'] });
    await montar([SPOTIFY, NETFLIX]);
    fireEvent.click(casillaDeLaPagina());

    await act(async () => fireEvent.click(botonConfirmar()));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Spotify: Está rechazado. Para confirmarlo hay que volver a importar el archivo.'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Texto técnico.');
    expect(itemDe('Netflix')).toHaveTextContent('Confirmado');
  });

  it('Cerrar quita el resultado y deja el foco en la lista', async () => {
    await montar([SPOTIFY]);
    fireEvent.click(casillaDe(SPOTIFY));
    await act(async () => fireEvent.click(botonConfirmar()));

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(screen.queryByLabelText('Resultado de la confirmación')).not.toBeInTheDocument();
    expect(lista()).toHaveFocus();
  });
});
