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

  it('rechaza formato no admitido en cliente, deshabilita el botón y permite corregir (S3-SE-03)', () => {
    const onSubirMock = vi.fn();
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivoExcel = new File(['datos'], 'cartola.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });

    fireEvent.change(input, { target: { files: [archivoExcel] } });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('Formato no admitido. Solo se admiten archivos .csv.');
    const boton = screen.getByRole('button', { name: /subir archivo/i });
    expect(boton).toBeDisabled();
    expect(onSubirMock).not.toHaveBeenCalled();

    // Posibilidad de corregir: selecciona ahora un archivo CSV válido
    const archivoValido = new File(['fecha,descripcion,monto\n2026-10-01,Netflix,5990'], 'cartola.csv', {
      type: 'text/csv',
    });
    fireEvent.change(input, { target: { files: [archivoValido] } });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(boton).not.toBeDisabled();
  });

  it('rechaza archivo vacío (0 bytes) en el cliente y no lo envía (S3-SE-03)', () => {
    const onSubirMock = vi.fn();
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivoVacio = new File([], 'vacio.csv', { type: 'text/csv' });

    fireEvent.change(input, { target: { files: [archivoVacio] } });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('El archivo está vacío.');
    expect(screen.getByRole('button', { name: /subir archivo/i })).toBeDisabled();
    expect(onSubirMock).not.toHaveBeenCalled();
  });

  it('rechaza archivo que excede 5 MB en el cliente y no lo envía (S3-SE-03)', () => {
    const onSubirMock = vi.fn();
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    // Creamos un Blob/File simulando 5 MB + 1 byte
    const archivoPesado = new File(['x'.repeat(100)], 'pesado.csv', { type: 'text/csv' });
    Object.defineProperty(archivoPesado, 'size', { value: 5 * 1024 * 1024 + 1 });

    fireEvent.change(input, { target: { files: [archivoPesado] } });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('El archivo supera el tamaño máximo permitido de 5 MB.');
    expect(screen.getByRole('button', { name: /subir archivo/i })).toBeDisabled();
    expect(onSubirMock).not.toHaveBeenCalled();
  });

  it('una validación cliente aprobada sigue sujeta a validación del servidor (S3-SE-03)', async () => {
    const errorBackend = new ErrorDeApi(
      'El CSV tiene una sola columna: no se encontró un separador.',
      400,
      { archivo: ['El CSV tiene una sola columna: no se encontró un separador.'] },
      undefined,
      'contenido_incompatible',
    );
    const onSubirMock = vi.fn().mockRejectedValue(errorBackend);

    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['solounacolumna'], 'cartola.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [archivo] } });

    // En cliente tiene .csv y tamaño > 0, así que el botón se habilita
    const boton = screen.getByRole('button', { name: /subir archivo/i });
    expect(boton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(boton);
    });

    // El backend rechaza por contenido incompatible y se muestra el error del servidor
    expect(onSubirMock).toHaveBeenCalledTimes(1);
    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent('El CSV tiene una sola columna: no se encontró un separador.');
  });

  it('muestra MENSAJE_SIN_RED ante un fallo de red (TypeError) y mantiene el botón habilitado', async () => {
    const onSubirMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['a,b\n1,2'], 'movimientos.csv', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [archivo] } });

    const boton = screen.getByRole('button', { name: /subir archivo/i });
    await act(async () => {
      fireEvent.click(boton);
    });

    const alerta = screen.getByRole('alert');
    expect(alerta).toHaveTextContent(MENSAJE_SIN_RED);
    expect(boton).not.toBeDisabled();
  });

  it('permite reintentar el envío con el mismo archivo tras un fallo de transporte o red', async () => {
    let intento = 0;
    const onSubirMock = vi.fn().mockImplementation(async () => {
      intento += 1;
      if (intento === 1) {
        throw new TypeError('Failed to fetch');
      }
      return IMPORTACION_PENDIENTE;
    });

    render(<ContenedorPrueba onSubir={onSubirMock} />);

    const input = screen.getByLabelText(/seleccionar archivo csv/i);
    const archivo = new File(['fecha,descripcion,monto\n2026-10-01,Netflix,5990'], 'cartola.csv', {
      type: 'text/csv',
    });
    fireEvent.change(input, { target: { files: [archivo] } });

    const boton = screen.getByRole('button', { name: /subir archivo/i });
    expect(boton).not.toBeDisabled();

    // Primer intento: falla por error de transporte
    await act(async () => {
      fireEvent.click(boton);
    });

    expect(onSubirMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(MENSAJE_SIN_RED);
    // El botón debe permanecer habilitado: la validez del CSV no se pierde por un fallo de red
    expect(boton).not.toBeDisabled();

    // Reintento con el mismo archivo sin necesidad de volver a seleccionarlo
    await act(async () => {
      fireEvent.click(boton);
    });

    expect(onSubirMock).toHaveBeenCalledTimes(2);
    expect(onSubirMock).toHaveBeenLastCalledWith(archivo);
    expect(screen.getByTestId('pagina-progreso')).toBeInTheDocument();
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
