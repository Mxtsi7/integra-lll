// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatearFecha, TAMANO_PAGINA_CANDIDATOS, type CandidatoDetectado, type Paginado } from '@ojoalgasto/shared';
import type { CargaCandidatos } from './cargaCandidatos';
import { ListaCandidatos } from './ListaCandidatos';

// S3-CH-04: el componente solo dibuja. Los datos son inventados y no hay ninguna llamada a un servicio.
function candidato(sobrescribir: Partial<CandidatoDetectado> = {}): CandidatoDetectado {
  return {
    id: 'c-1',
    importacion: '6f1c2b8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f',
    origen: 'csv',
    origen_legible: 'Archivo CSV o cartola',
    identificador_origen: 'sha:3',
    servicio: 'Spotify',
    servicio_texto: 'SPOTIFY *PREMIUM',
    servicio_resultado: 'reconocido',
    importe: '5900.00',
    moneda: 'CLP',
    fecha: '2026-10-28',
    tipo_mensaje: 'cobro_realizado',
    tipo_mensaje_legible: 'Cobro realizado',
    estado: 'propuesto',
    estado_legible: 'Propuesto',
    decidido_en: null,
    decidido_por: '',
    aplicacion: null,
    evidencia: { fila: '3' },
    creado_en: '2026-10-28T22:00:00-03:00',
    ...sobrescribir,
  };
}

function pagina(sobrescribir: Partial<Paginado<CandidatoDetectado>> = {}): Paginado<CandidatoDetectado> {
  return { count: 1, next: null, previous: null, results: [candidato()], ...sobrescribir };
}

const listoCon = (datos: Paginado<CandidatoDetectado>): CargaCandidatos => ({ tipo: 'listo', datos });

function montar({ carga = listoCon(pagina()), numeroDePagina = 1 }: { carga?: CargaCandidatos; numeroDePagina?: number } = {}) {
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
    montar({ carga: listoCon(pagina({ count: 0, results: [] })) });

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
    expect(item).toHaveTextContent('$5.900');
    expect(item).toHaveTextContent(`Archivo CSV o cartola · ${formatearFecha('2026-10-28')} · Cobro realizado`);
    expect(item).toHaveTextContent('Propuesto');
  });

  it('un proveedor reconocido no lleva aviso de proveedor', () => {
    montar();

    expect(itemDe('Spotify')).not.toHaveTextContent('Proveedor sin');
  });

  it('un proveedor desconocido muestra el texto original del cobro y lo dice, sin inventar un nombre', () => {
    montar({
      carga: listoCon(pagina({ results: [candidato({ servicio: null, servicio_texto: 'PAGO 4471 XYZ', servicio_resultado: 'desconocido' })] })),
    });

    expect(itemDe('PAGO 4471 XYZ')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('un proveedor ambiguo dice que el texto calza con más de uno', () => {
    montar({
      carga: listoCon(pagina({ results: [candidato({ servicio: null, servicio_texto: 'APPLE.COM/BILL', servicio_resultado: 'ambiguo' })] })),
    });

    expect(itemDe('APPLE.COM/BILL')).toHaveTextContent('Proveedor sin confirmar: el texto calza con más de uno.');
  });

  it.each(['constructor', 'motivo_nuevo'])('un resultado "%s" que la web no conoce da el aviso general', (resultado) => {
    montar({
      carga: listoCon(
        pagina({
          results: [candidato({ servicio: null, servicio_texto: 'COBRO RARO', servicio_resultado: resultado as CandidatoDetectado['servicio_resultado'] })],
        }),
      ),
    });

    expect(itemDe('COBRO RARO')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('sin texto original ni proveedor dice que el cobro no tiene descripción', () => {
    montar({ carga: listoCon(pagina({ results: [candidato({ servicio: null, servicio_texto: '' })] })) });

    expect(itemDe('Cobro sin descripción')).toHaveTextContent('Proveedor sin reconocer.');
  });

  it('un candidato confirmado con la orden en cola lo dice: todavía no hay suscripción ni cobro', () => {
    montar({
      carga: listoCon(pagina({ results: [candidato({ estado: 'confirmado', estado_legible: 'Confirmado', aplicacion: 'pendiente' })] })),
    });

    expect(itemDe('Spotify')).toHaveTextContent('orden pendiente de aplicar: todavía no hay suscripción ni cobro creados');
  });

  it('sin orden pendiente no dice nada de aplicar', () => {
    montar();

    expect(itemDe('Spotify')).not.toHaveTextContent('orden pendiente');
  });

  it('un importe en dólares lleva su moneda y sus decimales', () => {
    montar({ carga: listoCon(pagina({ results: [candidato({ importe: '4.50', moneda: 'USD' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('US$4,50');
  });

  it('un importe que no es un número se muestra tal cual, con su moneda', () => {
    montar({ carga: listoCon(pagina({ results: [candidato({ importe: 'no es un número' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('no es un número CLP');
  });

  it('una moneda que no existe no rompe la lista: el importe queda crudo', () => {
    montar({ carga: listoCon(pagina({ results: [candidato({ moneda: 'pesos' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('5900.00 pesos');
  });

  it('un importe que no cabe en un número exacto se muestra como lo mandó la API, sin dígitos inventados', () => {
    montar({ carga: listoCon(pagina({ results: [candidato({ importe: '12345678901234567890.00' })] })) });

    expect(itemDe('Spotify')).toHaveTextContent('12345678901234567890.00 CLP');
    expect(itemDe('Spotify').textContent).not.toContain('12.345.678.901.234.567.168');
  });

  it('cada cobro de la página aparece una vez, en el orden en que llegó', () => {
    montar({
      carga: listoCon(
        pagina({
          count: 2,
          results: [candidato({ id: 'c-1', servicio: 'Spotify' }), candidato({ id: 'c-2', servicio: 'Netflix', origen: 'correo', origen_legible: 'Correo' })],
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
    montar({ carga: listoCon(pagina({ count: 25, previous: null, next: 'http://x/?page=2' })), numeroDePagina: 1 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  });

  it('si el servidor no tiene página anterior, Anterior queda deshabilitado aunque no se esté en la página 1', () => {
    montar({ carga: listoCon(pagina({ count: 25, previous: null, next: 'http://x/?page=3' })), numeroDePagina: 2 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  });

  it('pedir la página siguiente o anterior avisa el número de página', () => {
    const { alCambiarPagina } = montar({
      carga: listoCon(pagina({ count: 25, previous: 'http://x/?page=1', next: 'http://x/?page=3' })),
      numeroDePagina: 2,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(alCambiarPagina).toHaveBeenNthCalledWith(1, 3);
    expect(alCambiarPagina).toHaveBeenNthCalledWith(2, 1);
  });

  it('la cuenta de páginas usa el tamaño que se pide al servidor', () => {
    montar({ carga: listoCon(pagina({ count: TAMANO_PAGINA_CANDIDATOS * 2 + 1, next: 'x' })), numeroDePagina: 1 });

    expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  });
});

describe('foco con el teclado (S3-CH-04)', () => {
  it('al pedir otra página el foco queda en la lista mientras carga, y no se pierde', () => {
    const { cambiarCarga } = montar({ carga: listoCon(pagina({ count: 25, next: 'http://x/?page=2' })), numeroDePagina: 1 });
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
