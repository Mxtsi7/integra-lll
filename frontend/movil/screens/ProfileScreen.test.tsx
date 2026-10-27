import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react-native';
import { getUsuarioActual, type Usuario } from '@ojoalgasto/shared';
import { App } from '../App';

// Se simula solo la red/paquete compartido. El árbol de navegación (App + Router +
// contextos + pantallas) es el REAL.
jest.mock('@ojoalgasto/shared', () => ({
  configurarApi: jest.fn(),
  getUsuarioActual: jest.fn(),
}));

const USUARIO: Usuario = {
  id: '1',
  nombre: 'Christopher',
  correo: 'c@test.cl',
  rol: 'titular',
  organizacion_id: 'org-1',
  plan: 'gratuito',
};

const getUsuarioMock = getUsuarioActual as jest.MockedFunction<typeof getUsuarioActual>;

beforeEach(() => {
  getUsuarioMock.mockReset();
  getUsuarioMock.mockResolvedValue(USUARIO);
});

afterEach(() => {
  cleanup();
});

describe('App: rutas privadas', () => {
  it('sin sesión, profile termina en el login', async () => {
    render(<App initialScreen="profile" />);
    expect(await screen.findByText('Bienvenido de nuevo')).toBeTruthy();
    expect(screen.queryByTestId('screen-profile')).toBeNull();
  });

  it('sin sesión, settings y home también terminan en el login', async () => {
    const { unmount } = render(<App initialScreen="settings" />);
    expect(await screen.findByText('Bienvenido de nuevo')).toBeTruthy();
    unmount();

    render(<App initialScreen="home" />);
    expect(await screen.findByText('Bienvenido de nuevo')).toBeTruthy();
  });
});

describe('ProfileScreen', () => {
  it('con sesión, muestra los datos del usuario', async () => {
    render(<App initialScreen="profile" initialUsuario={USUARIO} />);

    expect(screen.getByTestId('screen-profile')).toBeTruthy();
    expect(screen.getByText('Cargando perfil…')).toBeTruthy();

    expect(await screen.findByText('Christopher')).toBeTruthy();
    expect(screen.getByText('c@test.cl')).toBeTruthy();
    expect(screen.getByText('Plan: gratuito')).toBeTruthy();
    expect(getUsuarioMock).toHaveBeenCalledTimes(1);
  });

  it('si la API falla, muestra el error en vez de los datos', async () => {
    getUsuarioMock.mockRejectedValue(new Error('network'));
    render(<App initialScreen="profile" initialUsuario={USUARIO} />);

    expect(await screen.findByText('No se pudo cargar el perfil')).toBeTruthy();
    expect(screen.queryByText('Christopher')).toBeNull();
  });
});

describe('Navegación desde/hacia profile', () => {
  it('login → home → profile → volver regresa a home', async () => {
    render(<App />);

    fireEvent.press(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('screen-home')).toBeTruthy();

    fireEvent.press(screen.getByTestId('go-profile'));
    expect(await screen.findByTestId('screen-profile')).toBeTruthy();
    expect(screen.getByTestId('history').props.children.join('')).toContain('home › profile');

    fireEvent.press(screen.getByTestId('go-back'));
    expect(screen.getByTestId('screen-home')).toBeTruthy();
  });

  it('desde profile, ir a settings y volver conserva el orden del historial', async () => {
    render(<App initialScreen="profile" initialUsuario={USUARIO} />);
    await screen.findByText('Christopher');

    fireEvent.press(screen.getByTestId('go-settings'));
    expect(screen.getByTestId('screen-settings')).toBeTruthy();

    fireEvent.press(screen.getByTestId('go-back'));
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
  });

  it('cerrar sesión desde profile vuelve al login y lo deja protegido', async () => {
    render(<App initialScreen="profile" initialUsuario={USUARIO} />);
    await screen.findByText('Christopher');

    fireEvent.press(screen.getByTestId('logout'));
    expect(await screen.findByText('Bienvenido de nuevo')).toBeTruthy();
    expect(screen.queryByTestId('screen-profile')).toBeNull();
  });
});
