// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorDeApi, type Importacion } from '@ojoalgasto/shared';
import { AuthProvider, useAuth } from '../../context/AuthContext';
import { ToastProvider } from '../../context/ToastContext';
import { MENSAJE_SIN_RED } from '../../utils/mensajes';
import { SubirArchivoCsv } from './SubirArchivoCsv';

const IMPORTACION_PENDIENTE: Importacion = {
  id: 'imp-creada-1',
  origen: 'csv',
  origen_legible: 'Archivo CSV o cartola',
  nombre_archivo: 'cartola.csv',
  estado: 'pendiente',
  estado_legible: 'Pendiente',
  terminada: false,
  progreso: null,
  filas_totales: 15,
  filas_procesadas: 0,
  candidatos_detectados: 0,
  candidatos_confirmados: false,
  errores: [],
  errores_totales: 0,
  terminada_en: null,
  confirmada_en: null,
  creado_en: '2026-11-24T22:00:00Z',
};

function ContenedorPrueba({
  onSubir,
  onExito,
}: {
  onSubir?: (archivo: File) => Promise<Importacion>;
  onExito?: (importacion: Importacion) => void;
}) {
  return (
    <MemoryRouter initialEntries={['/importaciones']}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route
              path="/importaciones"
              element={<SubirArchivoCsv onSubir={onSubir} onExito={onExito} />}
            />
            <Route
              path="/importaciones/:id"
              element={<div data-testid="pagina-progreso">Progreso de importación</div>}
            />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  );
}

describe('SubirArchivoCsv (S3-SE-02, FE-07)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('el botón está deshabilitado si no se ha seleccionado ningún archivo', () => {
    render(<ContenedorPrueba />);
    const boton = screen.getByRole('button', { name: /subir archivo/i });
    expect(boton).toBeDisabled();
    expect(screen.getByLabelText(/seleccionar archivo csv/i)).toBeInTheDocument();
  });

  it('al seleccionar un archivo CSV el botón se habilita', () => {
    render(<ContenedorPrueba />);
    const input = screen.getByLabelText(/seleccionar archivo csv/i) as HTMLInputElement;
    const archivo = new File(['fecha,descripcion,monto\n2026-10-01,Netflix,5990'], 'cartola.csv', {
      type: 'text/csv',
    });

    fireEvent.change(input, { target: { files: [archivo] } });

    const boton = screen.getByRole('button', { name: /subir archivo/i });
    expect(boton).not.toBeDisabled();
  });

  it('envía el archivo seleccionado, muestra cargando y redirige con el id recibido', async () => {
    const onSubirMock = vi.fn().mockResolvedValue(IMPORTACION_PENDIENTE);
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['fecha,descripcion,monto\n2026-10-01,Netflix,5990'], 'cartola.csv', {
      type: 'text/csv',
    });

    fireEvent.change(input, { target: { files: [archivo] } });
    const boton = screen.getByRole('button', { name: /subir archivo/i });

    await act(async () => {
      fireEvent.click(boton);
    });

    expect(onSubirMock).toHaveBeenCalledTimes(1);
    expect(onSubirMock).toHaveBeenCalledWith(archivo);
    // Redirige al progreso sin afirmar éxito antes de tiempo
    expect(screen.getByTestId('pagina-progreso')).toBeInTheDocument();
    expect(screen.queryByText(/éxito/i)).not.toBeInTheDocument();
  });

  it('muestra el mensaje de error cuando el backend rechaza con ErrorDeApi', async () => {
    const errorBackend = new ErrorDeApi(
      'Solo se admiten archivos .csv o cartolas .pdf.',
      400,
      { archivo: ['Solo se admiten archivos .csv o cartolas .pdf.'] },
      undefined,
      'formato_no_admitido',
    );
    const onSubirMock = vi.fn().mockRejectedValue(errorBackend);

    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['invalido'], 'test.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [archivo] } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /subir archivo/i }));
    });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Solo se admiten archivos .csv o cartolas .pdf.');
  });

  it('muestra MENSAJE_SIN_RED ante un fallo de red (TypeError)', async () => {
    const onSubirMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['a,b\n1,2'], 'movimientos.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [archivo] } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /subir archivo/i }));
    });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(MENSAJE_SIN_RED);
  });

  it('descarta la redirección si la sesión cambia mientras la subida está en curso', async () => {
    let resolverSubida!: (val: Importacion) => void;
    const promesaSubida = new Promise<Importacion>((resolve) => {
      resolverSubida = resolve;
    });
    const onSubirMock = vi.fn().mockReturnValue(promesaSubida);
    const onExitoMock = vi.fn();

    let cambiarSesionFn!: () => void;
    function ComponenteConBotonDeSesion() {
      const { cerrarSesion } = useAuth();
      cambiarSesionFn = cerrarSesion;
      return <SubirArchivoCsv onSubir={onSubirMock} onExito={onExitoMock} />;
    }

    render(
      <MemoryRouter initialEntries={['/importaciones']}>
        <ToastProvider>
          <AuthProvider>
            <ComponenteConBotonDeSesion />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>,
    );

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['a,b\n1,2'], 'datos.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [archivo] } });

    // Inicia la subida
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /subir archivo/i }));
    });
    expect(onSubirMock).toHaveBeenCalledTimes(1);

    // Cambia la sesión (p. ej. cerrar sesión o login de otro usuario)
    act(() => {
      cambiarSesionFn();
    });

    // Termina la petición tardía de la sesión previa
    await act(async () => {
      resolverSubida(IMPORTACION_PENDIENTE);
    });

    // onExito no debe haberse llamado con los datos de la sesión anterior
    expect(onExitoMock).not.toHaveBeenCalled();
  });
});
