// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatearFecha, TAMANO_PAGINA_CANDIDATOS, type CandidatoDetectado, type Paginado } from '@ojoalgasto/shared';
import { useSeleccionCandidatos } from '../../hooks/useSeleccionCandidatos';
import { candidatoDePrueba, paginaDeCandidatosDePrueba } from '../../test/candidatosDePrueba';
import type { CargaCandidatos } from './cargaCandidatos';
import { ListaCandidatos } from './ListaCandidatos';
import { fraseDeLaFecha } from './presentacionDeCandidato';

// S3-CH-04: el componente solo dibuja. Los datos son inventados y no hay ninguna llamada a un servicio.
const listoCon = (datos: Paginado<CandidatoDetectado>): CargaCandidatos => ({ tipo: 'listo', datos });

function montar({ carga = listoCon(paginaDeCandidatosDePrueba()), numeroDePagina = 1 }: { carga?: CargaCandidatos; numeroDePagina?: number } = {}) {
  const alCambiarPagina = vi.fn();
  const alReintentar = vi.fn();
  const dibujar = (cargaActual: CargaCandidatos, paginaActual: number) => (
    <ListaCandidatos carga={cargaActual} pagina={paginaActual} alCambiarPagina={alCambiarPagina} alReintentar={alReintentar} />
  );
  const { rerender } = render(dibujar(carga, numeroDePagina));
  // Lo que hace la página real: después del aviso llega la carga nueva.
  const cambiarCarga = (cargaNueva: CargaCandidatos, paginaNueva = numeroDePagina) => rerender(dibujar(cargaNueva, paginaNueva));
  return { alCambiarPagina, alReintentar, cambiarCarga };
}

const lista = () => screen.getByRole('region', { name: 'Cobros encontrados' });
const itemDe = (nombre: string) => within(lista()).getByText(nombre).closest('li') as HTMLElement;
const cantidadDeCobros = () => within(lista()).queryAllByRole('listitem').length;

afterEach(() => {
  cleanup();
});

describe('estados de la carga (S3-CH-04)', () => {
  it('mientras carga lo anuncia, marca la lista como ocupada y no muestra datos de antes', () => {
    montar({ carga: { tipo: 'cargando' } });

    expect(screen.getByRole('status')).toHaveTextContent('Cargando los cobros encontrados…');
    expect(lista()).toHaveAttribute('aria-busy', 'true');
    expect(cantidadDeCobros()).toBe(0);
  });

  it('con un error muestra el mensaje que llega y Reintentar vuelve a pedir, sin mostrar cobros', () => {
    const { alReintentar } = montar({ carga: { tipo: 'error', mensaje: 'No pudimos conectar con el servidor.' } });

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos conectar con el servidor.');
    expect(cantidadDeCobros()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(alReintentar).toHaveBeenCalledTimes(1);
  });

  it('sin cobros dice cómo conseguirlos, en vez de una lista vacía', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: 0, results: [] })) });

    expect(screen.getByText(/Todavía no hay cobros encontrados/)).toBeInTheDocument();
    expect(cantidadDeCobros()).toBe(0);
    expect(screen.queryByRole('navigation', { name: 'Páginas de cobros encontrados' })).not.toBeInTheDocument();
  });

  it('con datos la lista ya no está ocupada', () => {
    montar();

    expect(lista()).toHaveAttribute('aria-busy', 'false');
  });
});

describe('contenido de cada cobro (S3-CH-04)', () => {
  it('muestra el proveedor, el importe con formato, el origen, la fecha, el tipo y el estado', () => {
    montar();

    const item = itemDe('Spotify');
    expect(item).toHaveTextContent('$5.900 CLP');
    expect(item).toHaveTextContent('Archivo CSV o cartola · fila 3');
    expect(item).toHaveTextContent(`Cobro realizado · el ${formatearFecha('2026-10-28')}`);
    expect(item).toHaveTextContent('Propuesto');
  });

  it('un proveedor reconocido no lleva aviso de proveedor', () => {
    montar();

    expect(itemDe('Spotify')).not.toHaveTextContent('Proveedor sin');
  });

  it('un proveedor desconocido muestra el texto original del cobro y lo dice, sin inventar un nombre', () => {
    montar({
      carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ servicio: null, servicio_texto: 'PAGO 4471 XYZ', servicio_resultado: 'desconocido' })] })),
    });

    expect(itemDe('PAGO 4471 XYZ')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('un proveedor ambiguo dice que el texto calza con más de uno', () => {
    montar({
      carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ servicio: null, servicio_texto: 'APPLE.COM/BILL', servicio_resultado: 'ambiguo' })] })),
    });

    expect(itemDe('APPLE.COM/BILL')).toHaveTextContent('Proveedor sin confirmar: el texto calza con más de uno.');
  });

  it.each(['constructor', 'motivo_nuevo'])('un resultado "%s" que la web no conoce da el aviso general', (resultado) => {
    montar({
      carga: listoCon(
        paginaDeCandidatosDePrueba({
          results: [candidatoDePrueba({ servicio: null, servicio_texto: 'COBRO RARO', servicio_resultado: resultado as CandidatoDetectado['servicio_resultado'] })],
        }),
      ),
    });

    expect(itemDe('COBRO RARO')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('sin texto original ni proveedor dice que el cobro no tiene descripción', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ servicio: null, servicio_texto: '' })] })) });

    expect(itemDe('Cobro sin descripción')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('un candidato confirmado con la orden en cola lo dice: todavía no hay suscripción ni cobro', () => {
    montar({
      carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ estado: 'confirmado', estado_legible: 'Confirmado', aplicacion: 'pendiente' })] })),
    });

    expect(itemDe('Spotify')).toHaveTextContent('orden pendiente de aplicar: todavía no hay suscripción ni cobro creados');
  });

  it('sin orden pendiente no dice nada de aplicar', () => {
    montar();

    expect(itemDe('Spotify')).not.toHaveTextContent('orden pendiente');
  });

  it('un importe en dólares lleva su moneda y sus decimales', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ importe: '4.50', moneda: 'USD' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('US$4,50');
  });

  it('un importe que no es un número se muestra tal cual, con su moneda', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ importe: 'no es un número' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('no es un número CLP');
  });

  it('una moneda que no existe no rompe la lista: el importe queda crudo', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ moneda: 'pesos' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('5900.00 pesos');
  });

  it('un importe que no cabe en un número exacto se muestra como lo mandó la API, sin dígitos inventados', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ results: [candidatoDePrueba({ importe: '12345678901234567890.00' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('12345678901234567890.00 CLP');
    expect(itemDe('Spotify').textContent).not.toContain('12.345.678.901.234.567.168');
  });

  it('cada cobro de la página aparece una vez, en el orden en que llegó', () => {
    montar({
      carga: listoCon(
        paginaDeCandidatosDePrueba({
          count: 2,
          results: [candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' }), candidatoDePrueba({ id: 'c-2', servicio: 'Netflix', origen: 'correo', origen_legible: 'Correo' })],
        }),
      ),
    });

    const nombres = within(lista())
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span')?.textContent);
    expect(nombres).toEqual(['Spotify', 'Netflix']);
    expect(itemDe('Netflix')).toHaveTextContent('Correo');
  });
});

describe('paginación (S3-CH-04)', () => {
  it('Anterior y Siguiente siguen lo que dice el servidor, no la cuenta', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: 25, previous: null, next: 'http://x/?page=2' })), numeroDePagina: 1 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  });

  it('si el servidor no tiene página anterior, Anterior queda deshabilitado aunque no se esté en la página 1', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: 25, previous: null, next: 'http://x/?page=3' })), numeroDePagina: 2 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });

  it('pedir la página siguiente o anterior avisa el número de página', () => {
    const { alCambiarPagina } = montar({
      carga: listoCon(paginaDeCandidatosDePrueba({ count: 25, previous: 'http://x/?page=1', next: 'http://x/?page=3' })),
      numeroDePagina: 2,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(alCambiarPagina).toHaveBeenNthCalledWith(1, 3);
    expect(alCambiarPagina).toHaveBeenNthCalledWith(2, 1);
  });

  it('la cuenta de páginas usa el tamaño que se pide al servidor', () => {
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: TAMANO_PAGINA_CANDIDATOS * 2 + 1, next: 'x' })), numeroDePagina: 1 });

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  });
});

describe('foco con el teclado (S3-CH-04)', () => {
  it('al pedir otra página el foco queda en la lista mientras carga, y no se pierde', () => {
    const { cambiarCarga } = montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: 25, next: 'http://x/?page=2' })), numeroDePagina: 1 });
    const siguiente = screen.getByRole('button', { name: 'Siguiente' });
    siguiente.focus();

    fireEvent.click(siguiente);
    cambiarCarga({ tipo: 'cargando' }, 2);

    expect(lista()).toHaveFocus();
  });

  it('al reintentar el foco queda en la lista: «Reintentar» desaparece mientras carga', () => {
    const { cambiarCarga } = montar({ carga: { tipo: 'error', mensaje: 'No pudimos cargar los cobros encontrados.' } });
    const botonReintentar = screen.getByRole('button', { name: 'Reintentar' });
    botonReintentar.focus();

    fireEvent.click(botonReintentar);
    cambiarCarga({ tipo: 'cargando' });

    expect(lista()).toHaveFocus();
  });

  it('la lista no entra en el orden de Tab: solo recibe el foco al cambiar de página o reintentar', () => {
    montar();

    expect(lista()).toHaveAttribute('tabindex', '-1');
  });
});


// S3-CH-07: la lista con la selección real. El hook es el de verdad; lo único inventado son los cobros.
function ListaConSeleccion({ carga }: { carga: CargaCandidatos }) {
  const seleccion = useSeleccionCandidatos(carga.tipo === 'listo' ? carga.datos.results : null);
  return <ListaCandidatos carga={carga} pagina={1} alCambiarPagina={() => {}} alReintentar={() => {}} seleccion={seleccion} />;
}

const SPOTIFY = candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' });
const NETFLIX = candidatoDePrueba({ id: 'c-2', servicio: 'Netflix', importe: '8990.00' });
const SIN_PROVEEDOR = candidatoDePrueba({ id: 'c-3', servicio: null, servicio_texto: 'PAGO 4471', servicio_resultado: 'desconocido' });
const CONFIRMADO = candidatoDePrueba({ id: 'c-4', servicio: 'Disney+', estado: 'confirmado', estado_legible: 'Confirmado', aplicacion: 'pendiente' });
const RECHAZADO = candidatoDePrueba({ id: 'c-5', servicio: 'HBO Max', estado: 'rechazado', estado_legible: 'Rechazado' });

const conLosCobros = (...cobros: CandidatoDetectado[]): CargaCandidatos =>
  listoCon(paginaDeCandidatosDePrueba({ count: cobros.length, results: cobros }));
const casillaDe = (cobro: CandidatoDetectado) =>
  screen.getByRole('checkbox', { name: new RegExp(`^Seleccionar ${cobro.servicio ?? cobro.servicio_texto},`) });
const casillaDeLaPagina = () => screen.getByRole('checkbox', { name: 'Seleccionar todos los de esta página' });

describe('selección de cobros (S3-CH-07)', () => {
  it('sin la selección la lista no tiene casillas ni barra', () => {
    montar();

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Ninguno seleccionado')).not.toBeInTheDocument();
  });

  it('cada cobro que espera decisión tiene su casilla, con un nombre que lo distingue de los demás', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);

    expect(screen.getByRole('checkbox', { name: `Seleccionar Spotify, $5.900 CLP, ${formatearFecha('2026-10-28')}` })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: `Seleccionar Netflix, $8.990 CLP, ${formatearFecha('2026-10-28')}` })).not.toBeChecked();
  });

  it('un cobro confirmado o rechazado no tiene casilla y sigue diciendo su estado', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, CONFIRMADO, RECHAZADO)} />);

    expect(screen.getAllByRole('checkbox', { name: /^Seleccionar (?!todos)/ })).toHaveLength(1);
    expect(itemDe('Disney+')).toHaveTextContent('Confirmado');
    expect(itemDe('HBO Max')).toHaveTextContent('Rechazado');
    expect(within(itemDe('Disney+')).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('marcar un cobro lo selecciona y el conteo lo dice; desmarcarlo lo quita', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ninguno seleccionado');

    fireEvent.click(casillaDe(SPOTIFY));
    expect(casillaDe(SPOTIFY)).toBeChecked();
    expect(casillaDe(NETFLIX)).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('1 seleccionado');

    fireEvent.click(casillaDe(SPOTIFY));
    expect(casillaDe(SPOTIFY)).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Ninguno seleccionado');
  });

  it('«Seleccionar todos los de esta página» marca los pendientes, y al repetirlo los desmarca', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX, CONFIRMADO)} />);

    fireEvent.click(casillaDeLaPagina());
    expect(casillaDe(SPOTIFY)).toBeChecked();
    expect(casillaDe(NETFLIX)).toBeChecked();
    expect(casillaDeLaPagina()).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('2 seleccionados');

    fireEvent.click(casillaDeLaPagina());
    expect(casillaDe(SPOTIFY)).not.toBeChecked();
    expect(casillaDeLaPagina()).not.toBeChecked();
  });

  it('con solo algunos marcados la casilla de la página queda a medias', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    expect(casillaDeLaPagina()).toHaveProperty('indeterminate', false);

    fireEvent.click(casillaDe(SPOTIFY));
    expect(casillaDeLaPagina()).toHaveProperty('indeterminate', true);
    expect(casillaDeLaPagina()).not.toBeChecked();

    fireEvent.click(casillaDe(NETFLIX));
    expect(casillaDeLaPagina()).toHaveProperty('indeterminate', false);
    expect(casillaDeLaPagina()).toBeChecked();
  });

  it('un cobro sin proveedor se puede seleccionar, y el conteo avisa que no se puede confirmar', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, SIN_PROVEEDOR)} />);

    fireEvent.click(casillaDeLaPagina());

    expect(screen.getByRole('status')).toHaveTextContent('2 seleccionados · 1 no se puede confirmar: proveedor sin reconocer');
  });

  it('varios sin proveedor se dicen en plural', () => {
    const otro = candidatoDePrueba({ id: 'c-6', servicio: null, servicio_texto: 'PAGO 9999', servicio_resultado: 'ambiguo' });
    render(<ListaConSeleccion carga={conLosCobros(SIN_PROVEEDOR, otro)} />);

    fireEvent.click(casillaDeLaPagina());

    expect(screen.getByRole('status')).toHaveTextContent('2 seleccionados · 2 no se pueden confirmar: proveedor sin reconocer');
  });

  it('«Limpiar selección» solo aparece con algo elegido, lo quita todo y devuelve el foco a la casilla de la página', () => {
    render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    expect(screen.queryByRole('button', { name: 'Limpiar selección' })).not.toBeInTheDocument();
    fireEvent.click(casillaDe(SPOTIFY));
    const limpiar = screen.getByRole('button', { name: 'Limpiar selección' });
    limpiar.focus();

    fireEvent.click(limpiar);

    expect(casillaDe(SPOTIFY)).not.toBeChecked();
    expect(screen.queryByRole('button', { name: 'Limpiar selección' })).not.toBeInTheDocument();
    expect(casillaDeLaPagina()).toHaveFocus();
  });

  it('sin cobros que esperen decisión no hay barra de selección', () => {
    render(<ListaConSeleccion carga={conLosCobros(CONFIRMADO, RECHAZADO)} />);

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Ninguno seleccionado')).not.toBeInTheDocument();
  });
});

describe('selección al refrescar (S3-CH-07)', () => {
  it('mientras carga no hay casillas, y al volver los cobros que siguen pendientes siguen elegidos', () => {
    const { rerender } = render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    fireEvent.click(casillaDeLaPagina());

    rerender(<ListaConSeleccion carga={{ tipo: 'cargando' }} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();

    rerender(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    expect(casillaDe(SPOTIFY)).toBeChecked();
    expect(casillaDe(NETFLIX)).toBeChecked();
  });

  it('un cobro que se resolvió al refrescar pierde su casilla y sale de la selección; el otro se conserva', () => {
    const { rerender } = render(<ListaConSeleccion carga={conLosCobros(SPOTIFY, NETFLIX)} />);
    fireEvent.click(casillaDeLaPagina());

    rerender(<ListaConSeleccion carga={conLosCobros({ ...SPOTIFY, estado: 'confirmado', estado_legible: 'Confirmado' }, NETFLIX)} />);

    expect(within(itemDe('Spotify')).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(casillaDe(NETFLIX)).toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('1 seleccionado');
  });

  it('al pasar a otra página lo que ya no se ve no queda seleccionado, ni vuelve al regresar', () => {
    const { rerender } = render(<ListaConSeleccion carga={conLosCobros(SPOTIFY)} />);
    fireEvent.click(casillaDe(SPOTIFY));

    rerender(<ListaConSeleccion carga={conLosCobros(NETFLIX)} />);
    expect(casillaDe(NETFLIX)).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Ninguno seleccionado');

    rerender(<ListaConSeleccion carga={conLosCobros(SPOTIFY)} />);
    expect(casillaDe(SPOTIFY)).not.toBeChecked();
  });
});

describe('importe, moneda, fecha y origen de cada cobro (S3-CH-05)', () => {
  const montarCon = (...cobros: CandidatoDetectado[]) => montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: cobros.length, results: cobros })) });
  const fechaDePrueba = formatearFecha('2026-10-28');

  it('el importe lleva el código de su moneda al lado', () => {
    montarCon(candidatoDePrueba({ id: 'c-1', servicio: 'Spotify' }), candidatoDePrueba({ id: 'c-2', servicio: 'Disney+', importe: '4.50', moneda: 'USD' }));

    expect(itemDe('Spotify')).toHaveTextContent('$5.900 CLP');
    expect(itemDe('Disney+')).toHaveTextContent('US$4,50 USD');
  });

  it('un importe con decimales que la moneda no usa se muestra completo, sin redondearlo', () => {
    montarCon(candidatoDePrueba({ importe: '5900.50' }));

    expect(itemDe('Spotify')).toHaveTextContent('$5.900,5 CLP');
    expect(itemDe('Spotify').textContent).not.toContain('$5.901');
  });

  it('sin moneda dice que no se indicó, en vez de suponer pesos', () => {
    montarCon(candidatoDePrueba({ moneda: '' }));

    expect(itemDe('Spotify')).toHaveTextContent('5900.00 (moneda sin indicar)');
    expect(itemDe('Spotify').textContent).not.toContain('CLP');
    expect(itemDe('Spotify').textContent).not.toContain('$');
  });

  it('un cobro realizado dice el día del cobro', () => {
    montarCon(candidatoDePrueba({ tipo_mensaje: 'cobro_realizado', tipo_mensaje_legible: 'Cobro realizado' }));

    expect(itemDe('Spotify')).toHaveTextContent(`Cobro realizado · el ${fechaDePrueba}`);
  });

  it('un aviso de cobro dice que el cobro está previsto: no se presenta como un pago hecho', () => {
    montarCon(candidatoDePrueba({ tipo_mensaje: 'aviso_de_cobro', tipo_mensaje_legible: 'Aviso de cobro' }));

    expect(itemDe('Spotify')).toHaveTextContent(`Aviso de cobro · previsto para el ${fechaDePrueba}`);
    expect(itemDe('Spotify').textContent).not.toContain('Cobro realizado');
  });

  it('un pago fallido dice que fue un intento', () => {
    montarCon(candidatoDePrueba({ tipo_mensaje: 'pago_fallido', tipo_mensaje_legible: 'Pago fallido' }));

    expect(itemDe('Spotify')).toHaveTextContent(`Pago fallido · intento el ${fechaDePrueba}`);
  });

  it('si la API no manda la etiqueta del tipo, la línea empieza por la fecha, sin separadores sueltos', () => {
    montarCon(candidatoDePrueba({ tipo_mensaje_legible: '' }));

    const linea = within(itemDe('Spotify')).getByText(`el ${fechaDePrueba}`);
    expect(linea.textContent).toBe(`el ${fechaDePrueba}`);
  });

  it('si el correo no traía la fecha del cobro y se usó la de recepción, lo dice', () => {
    montarCon(candidatoDePrueba({ tipo_mensaje: 'aviso_de_cobro', tipo_mensaje_legible: 'Aviso de cobro', evidencia: { fecha_origen: 'recepcion' } }));

    expect(itemDe('Spotify')).toHaveTextContent(`sin fecha de cobro: se usó la de recepción del correo (${fechaDePrueba})`);
    expect(itemDe('Spotify').textContent).not.toContain('previsto para el');
  });

  it('una fecha que no es un día real no rompe la lista: dice que no se indicó y los demás cobros se ven', () => {
    montarCon(candidatoDePrueba({ id: 'c-1', servicio: 'Spotify', fecha: '' }), candidatoDePrueba({ id: 'c-2', servicio: 'Netflix', fecha: '2026-02-30' }), candidatoDePrueba({ id: 'c-3', servicio: 'HBO Max' }));

    expect(cantidadDeCobros()).toBe(3);
    expect(itemDe('Spotify')).toHaveTextContent('Cobro realizado · fecha sin indicar');
    expect(itemDe('Netflix')).toHaveTextContent('fecha sin indicar');
    expect(itemDe('HBO Max')).toHaveTextContent(`el ${fechaDePrueba}`);
  });

  it('la casilla de un cobro sin fecha dice que no tiene fecha, y la de uno con fecha dice cuál', () => {
    const sinFecha = candidatoDePrueba({ id: 'c-1', servicio: 'Spotify', fecha: '' });
    render(<ListaConSeleccion carga={conLosCobros(sinFecha, NETFLIX)} />);

    expect(screen.getByRole('checkbox', { name: 'Seleccionar Spotify, $5.900 CLP, fecha sin indicar' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: `Seleccionar Netflix, $8.990 CLP, ${fechaDePrueba}` })).toBeInTheDocument();
  });

  it('un cobro de un CSV dice su fila de la cartola, y uno de correo no dice fila', () => {
    montarCon(
      candidatoDePrueba({ id: 'c-1', servicio: 'Spotify', origen: 'csv', origen_legible: 'Archivo CSV o cartola', evidencia: { fila: '14' } }),
      candidatoDePrueba({ id: 'c-2', servicio: 'Netflix', origen: 'correo', origen_legible: 'Correo', evidencia: { asunto: 'Tu próximo cobro' } }),
    );

    expect(itemDe('Spotify')).toHaveTextContent('Archivo CSV o cartola · fila 14');
    expect(itemDe('Netflix')).toHaveTextContent('Correo');
    expect(itemDe('Netflix').textContent).not.toContain('fila');
  });
});

// El contrato común v1 (S3-MX-25) vive en docs/contratos, fuera de frontend. Si esa carpeta no está (un checkout
// que solo trae frontend), estas pruebas se OMITEN y se ven como omitidas: no pasan en silencio.
// (Sin `new URL('…', import.meta.url)`: Vite lo reescribe como una dirección web y deja de ser una ruta de disco.)
const CARPETA_DE_CONTRATOS = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../docs/contratos');
const hayContratoV1 =
  existsSync(resolve(CARPETA_DE_CONTRATOS, 'candidatos-v1.schema.json')) && existsSync(resolve(CARPETA_DE_CONTRATOS, 'candidatos-v1.ejemplos.json'));

function leerDelContrato<T>(nombre: string): T {
  return JSON.parse(readFileSync(resolve(CARPETA_DE_CONTRATOS, nombre), 'utf-8')) as T;
}

interface EsquemaDeCandidatos {
  required: string[];
  properties: Record<string, { enum?: string[] }>;
}
type EjemploDelContrato = Partial<CandidatoDetectado> & { organizacion_id: string };

describe.skipIf(!hayContratoV1)('el contrato común de candidatos v1 (S3-CH-05, S3-MX-25)', () => {
  it('los campos que el contrato exige están en el candidato que recibe la lista, salvo organizacion_id, que la API no manda', () => {
    const { required } = leerDelContrato<EsquemaDeCandidatos>('candidatos-v1.schema.json');
    const camposDeLaLista = Object.keys(candidatoDePrueba());

    expect(required.filter((campo) => campo !== 'organizacion_id' && !camposDeLaLista.includes(campo))).toEqual([]);
    expect(camposDeLaLista).not.toContain('organizacion_id');
  });

  it('cada tipo de mensaje del contrato tiene su frase de fecha en la web: ninguno cae en el texto genérico', () => {
    const tipos = leerDelContrato<EsquemaDeCandidatos>('candidatos-v1.schema.json').properties.tipo_mensaje.enum ?? [];

    expect(tipos.length).toBeGreaterThan(0);
    for (const tipo of tipos) {
      expect(fraseDeLaFecha(candidatoDePrueba({ tipo_mensaje: tipo as CandidatoDetectado['tipo_mensaje'] }))).not.toMatch(/^fecha /);
    }
  });

  it('la lista dibuja los ejemplos del contrato: el CSV con su fila y el aviso de correo con su fecha prevista', () => {
    const ejemplos = leerDelContrato<EjemploDelContrato[]>('candidatos-v1.ejemplos.json');
    const aCandidato = ({ organizacion_id: _organizacion, ...ejemplo }: EjemploDelContrato, posicion: number) =>
      candidatoDePrueba({
        ...ejemplo,
        id: `ejemplo-${posicion}`,
        origen_legible: ejemplo.origen === 'csv' ? 'Archivo CSV o cartola' : 'Correo',
        tipo_mensaje_legible: ejemplo.tipo_mensaje === 'aviso_de_cobro' ? 'Aviso de cobro' : 'Cobro realizado',
      });
    const [csv, correo] = ejemplos.map(aCandidato);
    montar({ carga: listoCon(paginaDeCandidatosDePrueba({ count: 2, results: [{ ...csv, servicio: 'Netflix (CSV)' }, { ...correo, servicio: 'Netflix (correo)' }] })) });

    expect(itemDe('Netflix (CSV)')).toHaveTextContent('$5.990 CLP');
    expect(itemDe('Netflix (CSV)')).toHaveTextContent('Archivo CSV o cartola · fila 2');
    expect(itemDe('Netflix (CSV)')).toHaveTextContent(`Cobro realizado · el ${formatearFecha('2026-04-13')}`);
    expect(itemDe('Netflix (correo)')).toHaveTextContent('$5.990 CLP');
    expect(itemDe('Netflix (correo)')).toHaveTextContent(`Aviso de cobro · previsto para el ${formatearFecha('2026-04-13')}`);
  });
});
