// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../context/AuthContext';
import { ToastProvider } from '../context/ToastContext';
import { RetornoOAuthPage } from './RetornoOAuthPage';

afterEach(cleanup);

function UbicacionActual() {
  const loc = useLocation();
  return <output data-testid="ubicacion">{`${loc.pathname}${loc.search}`}</output>;
}

function montarRetorno(urlInicial: string, onProcesarCallback = vi.fn()) {
  return render(
    <MemoryRouter initialEntries={[urlInicial]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route
              path="/oauth/retorno"
              element={
                <>
                  <RetornoOAuthPage onProcesarCallback={onProcesarCallback} />
                  <UbicacionActual />
                </>
              }
            />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('RetornoOAuthPage (AN-16)', () => {
  it('procesa retorno válido, limpia parámetros sensibles de la URL y ofrece volver a cuentas', async () => {
    const procesar = vi.fn().mockResolvedValue({
      tipo: 'conectada',
      cuenta: {
        cuenta_externa: 'ana@gmail.com',
        proveedor_legible: 'Gmail',
      },
    });

    montarRetorno('/oauth/retorno?code=codigo_secreto_123&state=estado_valido_12345', procesar);
    await act(async () => {});

    expect(procesar).toHaveBeenCalledWith({
      estado_oauth: 'estado_valido_12345',
      codigo: 'codigo_secreto_123',
    });
    expect(screen.getByTestId('ubicacion')).toHaveTextContent('/oauth/retorno');
    expect(screen.getByTestId('ubicacion').textContent).not.toContain('codigo_secreto_123');
    expect(screen.getByText('Cuenta conectada correctamente')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Volver a mis cuentas' })).toHaveAttribute('href', '/cuentas');
  });

  it('muestra cancelación cuando el usuario rechaza el permiso en el proveedor', async () => {
    const procesar = vi.fn().mockResolvedValue({
      tipo: 'cancelada',
      proveedor: 'gmail',
      detalle: 'access_denied',
    });

    montarRetorno('/oauth/retorno?error=access_denied&state=estado_valido_12345', procesar);
    await act(async () => {});

    expect(screen.getByText('Autorización cancelada')).toBeInTheDocument();
  });

  it('rechaza parámetros manipulados o incompletos sin llamar al backend', async () => {
    const procesar = vi.fn();

    montarRetorno('/oauth/retorno?code=solo_codigo_sin_state', procesar);
    await act(async () => {});

    expect(procesar).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo conectar la cuenta');
  });
});
