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

beforeEach(() => {
  localStorage.clear();
  vi.mocked(pedir).mockReset().mockResolvedValue(PERSONA_ACTUAL);
  guardarTokens({ access_token: TOKEN, refresh_token: 'refresh-a' });
});

afterEach(() => {
  cleanup();
});

describe('el informe según cómo vaya la carga (S3-CH-25)', () => {
  it('cargando: lo dice y no muestra cifras', async () => {
    await montar({ tipo: 'cargando' });

    expect(screen.getByRole('status', { name: 'Cargando tus gastos' })).toBeInTheDocument();
    expect(screen.queryByText('Gasto real')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Descargar/ })).not.toBeInTheDocument();
  });

  it('con error: lo anuncia como alerta, ofrece Reintentar y no muestra cifras', async () => {
    const { onReintentar } = await montar({ tipo: 'error', mensaje: 'No pudimos cargar tus gastos. Intenta de nuevo.' });

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tus gastos. Intenta de nuevo.');
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onReintentar).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Gasto real')).not.toBeInTheDocument();
  });

  it('vacío: dice que no hay cobros en esa moneda, sin cifras en cero ni descarga', async () => {
    await montar(sinGastos());

    expect(screen.getByText(/No hay cobros en CLP en los últimos 6 meses/)).toBeInTheDocument();
    expect(screen.queryByText('Gasto real')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Descargar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con datos: muestra las cifras, el gráfico con su tabla y la descarga', async () => {
    await montar(conGastos());

    expect(screen.getByRole('region', { name: 'Resumen del mes' })).toBeInTheDocument();
    expect(screen.getByRole('img')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Detalle por mes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeInTheDocument();
  });

  it('las cifras son las del mes elegido, el último, y coinciden con su fila de la tabla', async () => {
    await montar(conGastos());

    const cifras = screen.getByRole('region', { name: 'Resumen del mes' });
    expect(within(cifras).getByText('$30.000')).toBeInTheDocument(); // real
    expect(within(cifras).getByText('$10.000')).toBeInTheDocument(); // proyectado
    expect(within(cifras).getByText('$40.000')).toBeInTheDocument(); // total
    const ultimaFila = within(screen.getByRole('table')).getAllByRole('row').at(-1) as HTMLElement;
    expect(ultimaFila).toHaveTextContent('Octubre de 2026');
    expect(ultimaFila).toHaveTextContent('$30.000');
    expect(ultimaFila).toHaveTextContent('$10.000');
    expect(ultimaFila).toHaveTextContent('$40.000');
  });

  it('un mes elegido en cero con gastos en los anteriores sí muestra el informe, con sus ceros', async () => {
    await montar({ tipo: 'listo', meses: [mes('2026-09', '2000.00'), mes('2026-10', '0.00')] });

    const cifras = screen.getByRole('region', { name: 'Resumen del mes' });
    expect(within(cifras).getAllByText('$0')).toHaveLength(3);
    expect(screen.queryByText(/No hay cobros/)).not.toBeInTheDocument();
  });
});
