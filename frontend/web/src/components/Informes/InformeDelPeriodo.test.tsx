// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResumenDelMes } from '@ojoalgasto/shared';
import { pedir } from '../../../../shared/src/api/cliente';
import { guardarTokens } from '../../../../shared/src/auth';
import { AuthProvider } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import type { CargaInforme } from '../../hooks/useInformeMensual';
import { resumenDePrueba } from '../../test/informesDePrueba';
import { crearTokenDePrueba } from '../../test/tokensDePrueba';
import { InformeDelPeriodo } from './InformeDelPeriodo';

// Solo se simula la red (pedir): la descarga se arma sola con sus hooks reales.
vi.mock('../../../../shared/src/api/cliente', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../../shared/src/api/cliente')>();
  return { ...real, pedir: vi.fn() };
});

const TOKEN = crearTokenDePrueba({ user_id: 7, organizacion_id: 'org-a', sid: 'sesion-a', jti: 'a-1' });
const PERSONA_ACTUAL = { id: '7', nombre: 'Ana', correo: 'ana@ejemplo.com', rol: 'titular', organizacion_id: 'org-a', plan: 'premium' };

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>{children}</AuthProvider>
    </ToastProvider>
  );
}

const mes = (periodo: string, real: string, proyectado = '0.00'): ResumenDelMes =>
  resumenDePrueba({ periodo, gasto_real: real, gasto_proyectado: proyectado, total_estimado: (Number(real) + Number(proyectado)).toFixed(2) });

const conGastos = (): CargaInforme => ({
  tipo: 'listo',
  meses: [mes('2026-08', '1000.00'), mes('2026-09', '2000.00'), mes('2026-10', '30000.00', '10000.00')],
});
const sinGastos = (): CargaInforme => ({ tipo: 'listo', meses: [mes('2026-09', '0.00'), mes('2026-10', '0.00')] });

const montar = async (carga: CargaInforme, onReintentar = vi.fn()) => {
  render(<InformeDelPeriodo carga={carga} mes="2026-10" moneda="CLP" onReintentar={onReintentar} />, { wrapper: Proveedores });
  await act(async () => {});
  return { onReintentar };
};

const tablaDelHistorico = () => screen.getByRole('table', { name: 'Detalle por mes' });

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset().mockResolvedValue(PERSONA_ACTUAL);
  guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('el informe según cómo vaya la carga (S3-CH-25)', () => {
  it('cargando: lo dice y no muestra la tabla ni la descarga', async () => {
    await montar({ tipo: 'cargando' });

    expect(screen.getByRole('status', { name: 'Cargando tus gastos' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Descargar/ })).not.toBeInTheDocument();
  });

  it('con error: lo anuncia como alerta, ofrece Reintentar y no muestra la tabla', async () => {
    const { onReintentar } = await montar({ tipo: 'error', mensaje: 'No pudimos cargar tus gastos. Intenta de nuevo.' });

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tus gastos. Intenta de nuevo.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onReintentar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('vacío: dice que no hay cobros de suscripciones activas, sin tabla, y la descarga sigue disponible', async () => {
    await montar(sinGastos());

    expect(screen.getByText(/No hay cobros de suscripciones activas en CLP en los últimos 6 meses/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('vacío: avisa que los cobros de suscripciones eliminadas pueden estar en la descarga de abajo', async () => {
    await montar(sinGastos());

    expect(screen.getByText(/Si eliminaste alguna, sus cobros pueden estar en la descarga de abajo/)).toBeInTheDocument();
    expect(screen.getByText(/Incluye también los de suscripciones que eliminaste/)).toBeInTheDocument();
  });

  it('con datos: muestra el gráfico con su tabla y la descarga', async () => {
    await montar(conGastos());

    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(tablaDelHistorico()).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeInTheDocument();
  });

  it('la descarga avisa que trae también los cobros de suscripciones eliminadas', async () => {
    await montar(conGastos());

    expect(screen.getByText(/Incluye también los de suscripciones que eliminaste/)).toBeInTheDocument();
  });

  it('la última fila es el mes elegido, con sus cifras', async () => {
    await montar(conGastos());

    const ultimaFila = within(tablaDelHistorico()).getAllByRole('row').at(-1) as HTMLElement;
    expect(ultimaFila).toHaveTextContent('Octubre de 2026');
    expect(ultimaFila).toHaveTextContent('$30.000');
    expect(ultimaFila).toHaveTextContent('$10.000');
    expect(ultimaFila).toHaveTextContent('$40.000');
  });

  it('un mes elegido en cero con gastos en los anteriores sí muestra el informe, con sus ceros', async () => {
    await montar({ tipo: 'listo', meses: [mes('2026-09', '2000.00'), mes('2026-10', '0.00')] });

    const ultimaFila = within(tablaDelHistorico()).getAllByRole('row').at(-1) as HTMLElement;
    expect(within(ultimaFila).getAllByText('$0')).toHaveLength(3);
    expect(screen.queryByText(/No hay cobros/)).not.toBeInTheDocument();
  });
});
