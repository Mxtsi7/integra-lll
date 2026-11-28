// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidatoDetectado } from '@ojoalgasto/shared';
import { ErrorDeApi, pedir } from '../../../../shared/src/api/cliente';
import { guardarTokens } from '../../../../shared/src/auth';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { candidatoDePrueba, paginaDeCandidatosDePrueba } from '../../test/candidatosDePrueba';
import { crearTokenDePrueba } from '../../test/tokensDePrueba';
import type { CargaCandidatos } from './cargaCandidatos';
import type { DecisionesDeCandidatos, ResultadoDecisiones } from './decisionesCandidatos';
import { ListaCandidatos } from './ListaCandidatos';
import { RevisionDeCandidatos } from './RevisionDeCandidatos';
import type { SeleccionDeCandidatos } from './seleccionCandidatos';

// Solo se simula la red (pedir). La lista, la selección y las decisiones son las reales.
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
  aplicacion: 'por_enviar',
});
const rechazado = (cobro: CandidatoDetectado): CandidatoDetectado => ({
  ...cobro,
  estado: 'rechazado',
  estado_legible: 'Rechazado',
});

const botonConfirmar = () => screen.getByRole('button', { name: /^Confirm(ar|ando)/ });
const botonRechazar = () => screen.getByRole('button', { name: /^Rechaz(ar|ando)/ });
const casillaDe = (cobro: CandidatoDetectado) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Seleccionar ${cobro.servicio ?? cobro.servicio_texto},`) });
const casillaDeLaPagina = () => screen.getByRole('checkbox', { name: 'Seleccionar todos los de esta página' });
const lista = () => screen.getByRole('region', { name: 'Cobros encontrados' });
const resultadoDeConfirmar = () => screen.getByLabelText('Resultado de la confirmación');
const resultadoDeRechazar = () => screen.getByLabelText('Resultado del rechazo');
const itemDe = (nombre: string) => within(lista()).getByText(nombre).closest('li') as HTMLElement;

afterEach(() => {
  cleanup();
});

describe('los botones Confirmar y Rechazar, con una decisión inventada (S3-CH-08 y S3-CH-09)', () => {
  const seleccionConIds = (ids: string[], idsParaConfirmar = ids, cantidadSeleccionable = 4): SeleccionDeCandidatos => ({
    seleccionados: new Set(ids),
    idsParaConfirmar,
    cantidadSeleccionable,
    alAlternar: vi.fn(),
    alAlternarPagina: vi.fn(),
    alLimpiar: vi.fn(),
  });
  const decisionesFalsas = (parcial: Partial<DecisionesDeCandidatos> = {}): DecisionesDeCandidatos => ({
    accionEnCurso: null,
    resultado: null,
    alConfirmar: vi.fn(),
    alRechazar: vi.fn(),
    alCerrarResultado: vi.fn(),
    ...parcial,
  });
  const montar = ({
    seleccion = seleccionConIds([]),
    decisiones = decisionesFalsas(),
    carga = conLosCobros(SPOTIFY, NETFLIX, SIN_PROVEEDOR, HBO),
  }: { seleccion?: SeleccionDeCandidatos; decisiones?: DecisionesDeCandidatos | null; carga?: CargaCandidatos } = {}) =>
    render(
      <ListaCandidatos
        carga={carga}
        pagina={1}
        alCambiarPagina={() => {}}
        alReintentar={() => {}}
        seleccion={seleccion}
        decisiones={decisiones ?? undefined}
      />,
    );

  describe('la barra de decisiones', () => {
    it('sin las decisiones no hay botones de decisión, aunque haya selección', () => {
      montar({ seleccion: seleccionConIds(['c-1']), decisiones: null });

      expect(screen.queryByRole('button', { name: /^Confirmar/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Rechazar/ })).not.toBeInTheDocument();
    });

    it('sin nada seleccionado los dos botones están deshabilitados', () => {
      montar();

      expect(botonConfirmar()).toBeDisabled();
      expect(botonConfirmar()).toHaveTextContent('Confirmar');
      expect(botonRechazar()).toBeDisabled();
      expect(botonRechazar()).toHaveTextContent('Rechazar');
    });

    it.each([
      [['c-1'], '1 cobro'],
      [['c-1', 'c-2'], '2 cobros'],
    ])('con %j seleccionados dice cuántos cobros confirma y cuántos rechaza', (ids, texto) => {
      montar({ seleccion: seleccionConIds(ids) });

      expect(botonConfirmar()).toBeEnabled();
      expect(botonConfirmar()).toHaveTextContent(`Confirmar ${texto}`);
      expect(botonRechazar()).toBeEnabled();
      expect(botonRechazar()).toHaveTextContent(`Rechazar ${texto}`);
    });

    it('confirmar solo cuenta los que tienen proveedor; rechazar cuenta todos los seleccionados', () => {
      montar({ seleccion: seleccionConIds(['c-1', 'c-3'], ['c-1']) });

      expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');
      expect(botonRechazar()).toHaveTextContent('Rechazar 2 cobros');
    });

    it('con solo cobros sin proveedor seleccionados no hay nada que confirmar, pero sí se pueden rechazar', () => {
      montar({ seleccion: seleccionConIds(['c-3'], []) });

      expect(botonConfirmar()).toBeDisabled();
      expect(botonRechazar()).toBeEnabled();
      expect(botonRechazar()).toHaveTextContent('Rechazar 1 cobro');
    });

    describe('rechazar pide confirmación antes de mandar nada', () => {
      const pregunta = () => screen.getByRole('alertdialog', { name: '¿Rechazar 2 cobros?' });

      it('al pulsar Rechazar pregunta cuántos cobros se rechazan y no rechaza nada todavía', () => {
        const decisiones = decisionesFalsas();
        montar({ seleccion: seleccionConIds(['c-1', 'c-2']), decisiones });

        fireEvent.click(botonRechazar());

        expect(within(pregunta()).getByText('No se puede deshacer.')).toBeInTheDocument();
        expect(decisiones.alRechazar).not.toHaveBeenCalled();
      });

      it('el foco de la pregunta empieza en Cancelar, no en Rechazar', () => {
        montar({ seleccion: seleccionConIds(['c-1', 'c-2']) });

        fireEvent.click(botonRechazar());

        expect(within(pregunta()).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
      });

      it('Cancelar cierra la pregunta sin rechazar y el foco vuelve al botón Rechazar', () => {
        const decisiones = decisionesFalsas();
        montar({ seleccion: seleccionConIds(['c-1', 'c-2']), decisiones });
        botonRechazar().focus();
        fireEvent.click(botonRechazar());

        fireEvent.click(within(pregunta()).getByRole('button', { name: 'Cancelar' }));

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(decisiones.alRechazar).not.toHaveBeenCalled();
        expect(botonRechazar()).toHaveFocus();
      });

      it('Escape también cierra la pregunta sin rechazar', () => {
        const decisiones = decisionesFalsas();
        montar({ seleccion: seleccionConIds(['c-1', 'c-2']), decisiones });
        fireEvent.click(botonRechazar());

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
        expect(decisiones.alRechazar).not.toHaveBeenCalled();
      });

      it('Rechazar dentro de la pregunta manda el rechazo una sola vez y el foco queda en la lista', () => {
        const decisiones = decisionesFalsas();
        montar({ seleccion: seleccionConIds(['c-1', 'c-2']), decisiones });
        fireEvent.click(botonRechazar());

        fireEvent.click(within(pregunta()).getByRole('button', { name: 'Rechazar' }));

        expect(decisiones.alRechazar).toHaveBeenCalledTimes(1);
        expect(decisiones.alConfirmar).not.toHaveBeenCalled();
        expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      });
    });

    it('mientras confirma, el botón lo dice; ninguna decisión se puede pulsar ni limpiar la selección', () => {
      montar({ seleccion: seleccionConIds(['c-1']), decisiones: decisionesFalsas({ accionEnCurso: 'confirmar' }) });

      expect(botonConfirmar()).toHaveTextContent('Confirmando…');
      expect(botonRechazar()).toHaveTextContent('Rechazar 1 cobro');
      expect(botonConfirmar()).toBeDisabled();
      expect(botonRechazar()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Limpiar selección' })).toBeDisabled();
    });

    it('mientras rechaza, el botón lo dice; confirmar tampoco se puede pulsar', () => {
      montar({ seleccion: seleccionConIds(['c-1']), decisiones: decisionesFalsas({ accionEnCurso: 'rechazar' }) });

      expect(botonRechazar()).toHaveTextContent('Rechazando…');
      expect(botonRechazar()).toBeDisabled();
      expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');
      expect(botonConfirmar()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Limpiar selección' })).toBeDisabled();
    });
  });

  describe('el resultado por cobro', () => {
    const resultadoCon = (accion: ResultadoDecisiones['accion'], ...resultados: ResultadoDecisiones['resultados'][number][]): ResultadoDecisiones => ({
      accion,
      resultados,
    });
    const hecho = (id: string, nombre: string) => ({ id, nombre, tipo: 'hecho' as const });
    const fallido = (id: string, nombre: string, mensaje: string) => ({ id, nombre, tipo: 'fallido' as const, mensaje });

    it('si todos se confirmaron lo dice y aclara dónde se ven la suscripción y el cobro', () => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('confirmar', hecho('c-1', 'Spotify'), hecho('c-2', 'Netflix')) }) });

      const aviso = resultadoDeConfirmar();
      expect(aviso).toHaveAttribute('role', 'status');
      expect(aviso).toHaveTextContent('Confirmaste 2 cobros.');
      expect(aviso).toHaveTextContent('Las órdenes se envían a Suscripciones; revisa ahí la suscripción y el cobro.');
      expect(aviso).toHaveTextContent('Spotify: confirmado');
      expect(aviso).toHaveTextContent('Netflix: confirmado');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('de uno solo, en singular', () => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('confirmar', hecho('c-1', 'Spotify')) }) });

      expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
    });

    it('con fallos parciales al confirmar avisa como alerta y dice qué pasó con cada cobro', () => {
      montar({
        decisiones: decisionesFalsas({
          resultado: resultadoCon(
            'confirmar',
            hecho('c-1', 'Spotify'),
            fallido('c-2', 'Netflix', 'Ya está rechazado y esa decisión no se puede deshacer desde aquí.'),
          ),
        }),
      });

      const alerta = screen.getByRole('alert');
      expect(alerta).toBe(resultadoDeConfirmar());
      expect(alerta).toHaveTextContent('Confirmaste 1 de 2 cobros; el resto no se pudo.');
      expect(alerta).toHaveTextContent('Spotify: confirmado');
      expect(alerta).toHaveTextContent('Netflix: Ya está rechazado y esa decisión no se puede deshacer desde aquí.');
    });

    it.each([
      [[fallido('c-1', 'Spotify', 'x'), fallido('c-2', 'Netflix', 'y')], 'No se pudo confirmar ningún cobro.'],
      [[fallido('c-1', 'Spotify', 'x')], 'No se pudo confirmar el cobro.'],
    ])('si ninguno se confirmó no dice que se confirmó nada', (resultados, texto) => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('confirmar', ...resultados) }) });

      const alerta = screen.getByRole('alert');
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).not.toHaveTextContent('Confirmaste');
      expect(alerta).not.toHaveTextContent('Las órdenes se envían');
    });

    it('si todos se rechazaron lo dice, sin hablar de pendientes: rechazar no crea nada que aplicar', () => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('rechazar', hecho('c-1', 'Spotify'), hecho('c-2', 'Netflix')) }) });

      const aviso = resultadoDeRechazar();
      expect(aviso).toHaveAttribute('role', 'status');
      expect(aviso).toHaveTextContent('Rechazaste 2 cobros.');
      expect(aviso).toHaveTextContent('Spotify: rechazado');
      expect(aviso).toHaveTextContent('Netflix: rechazado');
      expect(aviso).not.toHaveTextContent(/pendiente/i);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('de uno solo al rechazar, en singular', () => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('rechazar', hecho('c-1', 'Spotify')) }) });

      expect(resultadoDeRechazar()).toHaveTextContent('Rechazaste 1 cobro.');
    });

    it('con fallos parciales al rechazar avisa como alerta y dice el motivo de cada uno', () => {
      montar({
        decisiones: decisionesFalsas({
          resultado: resultadoCon(
            'rechazar',
            hecho('c-1', 'Spotify'),
            fallido('c-2', 'Netflix', 'Ya está confirmado: desde aquí no se puede rechazar.'),
          ),
        }),
      });

      const alerta = screen.getByRole('alert');
      expect(alerta).toBe(resultadoDeRechazar());
      expect(alerta).toHaveTextContent('Rechazaste 1 de 2 cobros; el resto no se pudo.');
      expect(alerta).toHaveTextContent('Netflix: Ya está confirmado: desde aquí no se puede rechazar.');
    });

    it.each([
      [[fallido('c-1', 'Spotify', 'x'), fallido('c-2', 'Netflix', 'y')], 'No se pudo rechazar ningún cobro.'],
      [[fallido('c-1', 'Spotify', 'x')], 'No se pudo rechazar el cobro.'],
    ])('si ninguno se rechazó no dice que se rechazó nada', (resultados, texto) => {
      montar({ decisiones: decisionesFalsas({ resultado: resultadoCon('rechazar', ...resultados) }) });

      const alerta = screen.getByRole('alert');
      expect(alerta).toHaveTextContent(texto);
      expect(alerta).not.toHaveTextContent('Rechazaste');
    });

    it('Cerrar avisa que se cierra y el foco queda en la lista', () => {
      const decisiones = decisionesFalsas({ resultado: resultadoCon('confirmar', hecho('c-1', 'Spotify')) });
      montar({ decisiones });

      fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

      expect(decisiones.alCerrarResultado).toHaveBeenCalledTimes(1);
      expect(lista()).toHaveFocus();
    });

    it('se ve aunque ya no quede ningún cobro por decidir: la barra de selección no aparece, el resultado sí', () => {
      montar({
        carga: conLosCobros(confirmado(SPOTIFY)),
        seleccion: seleccionConIds([], [], 0),
        decisiones: decisionesFalsas({ resultado: resultadoCon('confirmar', hecho('c-1', 'Spotify')) }),
      });

      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
    });

    it('se ve mientras la lista se recarga, que es justo lo que pasa después de decidir', () => {
      montar({
        carga: { tipo: 'cargando' },
        decisiones: decisionesFalsas({ resultado: resultadoCon('rechazar', hecho('c-1', 'Spotify')) }),
      });

      expect(screen.getByText('Rechazaste 1 cobro.', { exact: false })).toBeInTheDocument();
      expect(lista()).toHaveAttribute('aria-busy', 'true');
    });

    it('sin resultado no hay recuadro', () => {
      montar();

      expect(screen.queryByRole('button', { name: 'Cerrar' })).not.toBeInTheDocument();
    });
  });
});

describe('seleccionar y decidir de punta a punta, con la API simulada (S3-CH-07, S3-CH-08 y S3-CH-09)', () => {
  const TOKEN = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
  const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };
  const RUTA_DE_DECISION = /^\/candidatos\/([^/]+)\/(confirmar|rechazar)\/$/;

  /** Lo que el servidor tiene guardado por cobro. Recargar la lista vuelve a leer esto. */
  let estadoEnServidor: Partial<Record<string, 'confirmado' | 'rechazado'>>;
  let fallos: Partial<Record<string, Error>>;
  let pendientes: Partial<Record<string, Promise<unknown>>>;
  /** Los cobros de la importación tal como los dejó el servidor; la página se lee de aquí. */
  let cobrosEnElServidor: CandidatoDetectado[];

  /** Lo que responde la API real: confirmar no deja rechazar y rechazar no deja confirmar un cobro ya decidido. */
  function respuestaDelServidor(id: string, accion: 'confirmar' | 'rechazar'): Promise<unknown> {
    const estado = estadoEnServidor[id];
    if (accion === 'confirmar') {
      if (estado === 'rechazado') return Promise.reject(new ErrorDeApi('Está rechazado.', 409, { codigo: ['candidato_rechazado'] }));
      estadoEnServidor[id] = 'confirmado';
      return Promise.resolve({ id, estado: 'confirmado', aplicacion: 'por_enviar' });
    }
    if (estado === 'confirmado') {
      return Promise.reject(new ErrorDeApi('Ya está confirmado.', 409, { codigo: ['candidato_ya_confirmado'] }));
    }
    estadoEnServidor[id] = 'rechazado';
    return Promise.resolve({ id, estado: 'rechazado' });
  }

  beforeEach(() => {
    localStorage.clear();
    guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
    estadoEnServidor = {};
    fallos = {};
    pendientes = {};
    cobrosEnElServidor = [];
    vi.mocked(pedir).mockReset().mockImplementation((ruta: string) => {
      if (String(ruta).startsWith('/candidatos/?')) {
        return Promise.resolve(paginaDeCandidatosDePrueba({ count: cobrosEnElServidor.length, results: cobrosEnElServidor.map(comoLoDejoElServidor) }));
      }
      const coincidencia = RUTA_DE_DECISION.exec(String(ruta));
      if (coincidencia === null) return Promise.resolve(PERSONA_ACTUAL);
      const [, id, accion] = coincidencia;
      if (fallos[id]) return Promise.reject(fallos[id]);
      if (pendientes[id]) return pendientes[id];
      return respuestaDelServidor(id, accion as 'confirmar' | 'rechazar');
    });
  });

  const llamadasA = (accion: 'confirmar' | 'rechazar') =>
    vi.mocked(pedir).mock.calls.map(([ruta]) => String(ruta)).filter((ruta) => ruta.endsWith(`/${accion}/`));
  const confirmaciones = () => llamadasA('confirmar');
  const rechazos = () => llamadasA('rechazar');

  function Proveedores({ children }: { children: ReactNode }) {
    return (
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    );
  }

  const comoLoDejoElServidor = (cobro: CandidatoDetectado): CandidatoDetectado => {
    const estado = estadoEnServidor[cobro.id];
    if (estado === 'confirmado') return confirmado(cobro);
    if (estado === 'rechazado') return rechazado(cobro);
    return cobro;
  };

  /** La revisión de verdad: lee la página del servidor y, después de decidir, la vuelve a leer. */
  const montar = async (cobros: CandidatoDetectado[]) => {
    cobrosEnElServidor = cobros;
    render(<RevisionDeCandidatos importacion="imp-1" />, { wrapper: Proveedores });
    await act(async () => {});
  };

  it('manda solo los cobros seleccionados para confirmar, y al terminar esos quedan confirmados y los demás siguen pendientes', async () => {
    await montar([SPOTIFY, NETFLIX, HBO]);
    fireEvent.click(casillaDe(SPOTIFY));
    fireEvent.click(casillaDe(NETFLIX));

    await act(async () => fireEvent.click(botonConfirmar()));

    expect(confirmaciones()).toEqual(['/candidatos/c-1/confirmar/', '/candidatos/c-2/confirmar/']);
    expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 2 cobros.');
    // La lista se volvió a leer: los dos pasaron a confirmados, sin casilla, y la selección quedó vacía.
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
    expect(within(itemDe('Spotify')).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(itemDe('Spotify')).toHaveTextContent('orden por enviar a Suscripciones');
    expect(itemDe('HBO Max')).toHaveTextContent('Propuesto');
    expect(casillaDe(HBO)).not.toBeChecked();
    expect(botonConfirmar()).toBeDisabled();
    expect(botonRechazar()).toBeDisabled();
  });

  it('un cobro sin proveedor reconocido no se confirma aunque se seleccione toda la página, pero sí se puede rechazar después', async () => {
    await montar([SPOTIFY, SIN_PROVEEDOR]);
    fireEvent.click(casillaDeLaPagina());
    expect(botonConfirmar()).toHaveTextContent('Confirmar 1 cobro');
    expect(botonRechazar()).toHaveTextContent('Rechazar 2 cobros');

    await act(async () => fireEvent.click(botonConfirmar()));

    expect(confirmaciones()).toEqual(['/candidatos/c-1/confirmar/']);
    expect(itemDe('PAGO 4471')).toHaveTextContent('Propuesto');
    expect(casillaDe(SIN_PROVEEDOR)).toBeChecked();
    expect(botonRechazar()).toHaveTextContent('Rechazar 1 cobro');
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
    expect(botonRechazar()).toBeDisabled();
    expect(itemDe('Spotify')).toHaveTextContent('Propuesto');
    expect(screen.queryByLabelText('Resultado de la confirmación')).not.toBeInTheDocument();

    await act(async () => {
      estadoEnServidor['c-1'] = 'confirmado';
      responder({ id: 'c-1', estado: 'confirmado' });
    });
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
  });

  it('mientras una tanda corre, ni confirmar ni rechazar se pueden pulsar; al terminar vuelven a estar disponibles', async () => {
    let responder!: (valor: unknown) => void;
    pendientes['c-1'] = new Promise((alResponder) => {
      responder = alResponder;
    });
    await montar([SPOTIFY, NETFLIX]);
    fireEvent.click(casillaDe(SPOTIFY));
    await act(async () => fireEvent.click(botonConfirmar()));

    fireEvent.click(casillaDe(NETFLIX));

    expect(botonConfirmar()).toBeDisabled();
    expect(botonRechazar()).toBeDisabled();
    expect(rechazos()).toHaveLength(0);

    await act(async () => {
      estadoEnServidor['c-1'] = 'confirmado';
      responder({ id: 'c-1', estado: 'confirmado' });
    });
    expect(resultadoDeConfirmar()).toHaveTextContent('Confirmaste 1 cobro.');
    expect(botonRechazar()).toHaveTextContent('Rechazar 1 cobro');
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

  it('un doble clic en Rechazar manda un solo rechazo por cobro, aunque la pregunta ya se haya cerrado', async () => {
    let responder!: (valor: unknown) => void;
    pendientes['c-1'] = new Promise((alResponder) => {
      responder = alResponder;
    });
    await montar([SPOTIFY]);
    fireEvent.click(casillaDe(SPOTIFY));
    fireEvent.click(botonRechazar());

    await act(async () => {
      fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rechazar' }));
    });
    // Mientras la tanda corre, el botón de la barra está deshabilitado: el segundo clic no llega a enviar nada.
    await act(async () => {
      fireEvent.click(botonRechazar());
    });

    expect(rechazos()).toEqual(['/candidatos/c-1/rechazar/']);
    await act(async () => responder({ id: 'c-1', estado: 'rechazado' }));
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

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Spotify: Ya está rechazado y esa decisión no se puede deshacer desde aquí.'),
    );
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

  it('rechaza los seleccionados, también los que no tienen proveedor, y quedan rechazados fuera de la selección', async () => {
    await montar([SPOTIFY, NETFLIX, SIN_PROVEEDOR]);
    fireEvent.click(casillaDe(SPOTIFY));
    fireEvent.click(casillaDe(SIN_PROVEEDOR));

    await act(async () => fireEvent.click(botonRechazar()));
    await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rechazar' })));

    expect(rechazos()).toEqual(['/candidatos/c-1/rechazar/', '/candidatos/c-3/rechazar/']);
    expect(confirmaciones()).toHaveLength(0);
    expect(resultadoDeRechazar()).toHaveTextContent('Rechazaste 2 cobros.');
    expect(itemDe('Spotify')).toHaveTextContent('Rechazado');
    expect(within(itemDe('Spotify')).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(itemDe('PAGO 4471')).toHaveTextContent('Rechazado');
    expect(itemDe('Netflix')).toHaveTextContent('Propuesto');
    expect(botonRechazar()).toBeDisabled();
  });

  it('rechazar un cobro que ya está confirmado en el servidor dice que ya está confirmado, y la lista se recarga con su estado real', async () => {
    await montar([SPOTIFY, NETFLIX]);
    // Mientras la lista está en pantalla, Spotify ya se confirmó en otra pestaña.
    estadoEnServidor['c-1'] = 'confirmado';
    fireEvent.click(casillaDeLaPagina());

    await act(async () => fireEvent.click(botonRechazar()));
    await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Rechazar' })));

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Rechazaste 1 de 2 cobros; el resto no se pudo.');
    expect(alerta).toHaveTextContent('Spotify: Ya está confirmado: desde aquí no se puede rechazar.');
    expect(itemDe('Spotify')).toHaveTextContent('Confirmado');
    expect(itemDe('Netflix')).toHaveTextContent('Rechazado');
  });
});
