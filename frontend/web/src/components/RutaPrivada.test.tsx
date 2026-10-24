// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getUsuarioActual,
  guardarTokens,
  hayTokenGuardado,
  login,
  logout,
  revocarSesion,
  type Usuario,
} from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider } from "../context/AuthContext";
import { RutaPrivada, SoloInvitados } from "./RutaPrivada";
import { AppLayout } from "./layout/AppLayout";
import Login from "../pages/Login";

// Solo se reemplazan las llamadas de red; tokens, logout() y la validación
// del JWT son las reales de shared (usan el localStorage de jsdom).
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getUsuarioActual: vi.fn(), login: vi.fn(), revocarSesion: vi.fn() };
});

// Con la suite completa corriendo en paralelo, algunas esperas de este
// archivo llegaban casi al segundo que dan por defecto waitFor/findBy. En
// jsdom, renderizar y buscar por rol (con `name`) cuesta en proporción al
// DOM: jsdom arma estilos por cada elemento y los calcula al buscar por rol.
//
// 1) Se quita el riel de navegación (BarraLateral): no tiene nada que ver
//    con la sesión y es más de la mitad del DOM de AppLayout (ocho enlaces
//    con íconos SVG). La barra superior (usuario, plan y "Cerrar sesión")
//    sigue siendo la real, porque es lo que estos tests revisan. Medido con
//    la suite completa en un notebook de 4 núcleos, la espera más larga
//    bajó de 987 ms a 566 ms.
vi.mock("./layout/BarraLateral", () => ({ BarraLateral: () => null }));

// 2) Lo que queda (Login, barra superior, toasts) sí es lo que se prueba, y
//    bajo carga igual pasa del medio segundo. Por eso el tiempo sube a 2 s,
//    solo en este archivo (Vitest corre cada archivo en su propio proceso).
//    Un test que pasa no espera de más; solo tarda más en reportar uno que
//    falla. No más de 2 s, para que un test con dos esperas lentas no choque
//    con los 5 s por test de Vitest.
configure({ asyncUtilTimeout: 2_000 });

const getUsuarioActualMock = vi.mocked(getUsuarioActual);
const loginMock = vi.mocked(login);
const revocarSesionMock = vi.mocked(revocarSesion);

const USUARIO: Usuario = {
  id: "1",
  nombre: "Christopher",
  correo: "c@test.cl",
  rol: "titular",
  organizacion_id: "org-1",
  plan: "premium",
};

function jwt(expEnMs: number): string {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(expEnMs / 1000) })}.firma`;
}

// Se usa guardarTokens() de shared en vez de escribir las claves de
// localStorage a mano: así el test no depende de cómo se llaman.
function guardarSesion(expEnMs: number) {
  guardarTokens({ access_token: jwt(expEnMs), refresh_token: "refresh" });
}

/** Lo que pasa en ESTA pestaña cuando otra cambia localStorage. */
function cambioEnOtraPestana(cambio: () => void) {
  act(() => {
    cambio();
    window.dispatchEvent(new StorageEvent("storage"));
  });
}

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function UbicacionActual() {
  const location = useLocation();
  return <div data-testid="ubicacion">{location.pathname}</div>;
}

function PaginaPrivada({ titulo }: { titulo: string }) {
  return (
    <AppLayout headerTitulo={titulo} headerSubtitulo="">
      <p>contenido privado</p>
    </AppLayout>
  );
}

/** Misma estructura de rutas que App.tsx, con páginas livianas. */
function montar(rutaInicial: string) {
  return render(
    <MemoryRouter initialEntries={[rutaInicial]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route element={<SoloInvitados />}>
              <Route path="/login" element={<Login />} />
            </Route>
            <Route element={<RutaPrivada />}>
              <Route path="/dashboard" element={<PaginaPrivada titulo="Panel" />} />
              <Route path="/home" element={<PaginaPrivada titulo="Inicio" />} />
              <Route path="/perfil" element={<PaginaPrivada titulo="Perfil" />} />
            </Route>
          </Routes>
          <UbicacionActual />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent;

beforeEach(() => {
  localStorage.clear();
  getUsuarioActualMock.mockReset();
  loginMock.mockReset();
  revocarSesionMock.mockReset();
  revocarSesionMock.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Protección de rutas privadas", () => {
  it.each(["/home", "/dashboard", "/perfil"])(
    "sin sesión, %s redirige a /login",
    async (ruta) => {
      montar(ruta);
      await waitFor(() => expect(ubicacion()).toBe("/login"));
      expect(screen.queryByText("contenido privado")).not.toBeInTheDocument();
      expect(getUsuarioActualMock).not.toHaveBeenCalled();
    },
  );

  it("con un token vencido redirige a /login y borra los tokens", async () => {
    guardarSesion(Date.now() - 60_000);
    montar("/dashboard");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("con un token que no es JWT redirige a /login", async () => {
    guardarTokens({ access_token: "undefined", refresh_token: "refresh" });
    montar("/perfil");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("con sesión, /login manda al panel", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/login");

    await waitFor(() => expect(ubicacion()).toBe("/dashboard"));
  });
});

describe("Recuperación de la sesión al recargar", () => {
  it("con token vigente muestra un spinner y luego la página con el usuario real", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    let responder: (u: Usuario) => void = () => {};
    getUsuarioActualMock.mockReturnValue(new Promise((r) => (responder = r)));

    montar("/perfil");

    // Mientras /usuarios/me/ no responde: ni login ni página.
    expect(screen.getByRole("status", { name: "Verificando tu sesión" })).toBeInTheDocument();
    expect(ubicacion()).toBe("/perfil");

    await act(async () => responder(USUARIO));

    expect(screen.getByText("contenido privado")).toBeInTheDocument();
    expect(screen.getByText("Christopher")).toBeInTheDocument();
    expect(screen.getByText("Plan Premium")).toBeInTheDocument();
    expect(ubicacion()).toBe("/perfil");
  });

  it("si /usuarios/me/ responde 401, cierra la sesión y va a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockRejectedValue(new ErrorDeApi("Token inválido", 401));
    montar("/dashboard");

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
  });

  it("si /usuarios/me/ falla por red, NO echa al usuario", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/dashboard");

    expect(await screen.findByText("contenido privado")).toBeInTheDocument();
    expect(hayTokenGuardado()).toBe(true);
  });
});

describe("Login y vuelta a la página pedida", () => {
  it("tras iniciar sesión vuelve a la ruta privada que se quiso abrir", async () => {
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    loginMock.mockResolvedValue({
      access_token: jwt(Date.now() + 30 * 60_000),
      refresh_token: "refresh",
      usuario: { id: 1, nombre: "Christopher", correo: "c@test.cl" },
    });

    montar("/perfil");
    await waitFor(() => expect(ubicacion()).toBe("/login"));

    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "c@test.cl" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "Clave1234!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/perfil"));
    expect(await screen.findByText("contenido privado")).toBeInTheDocument();
    expect(hayTokenGuardado()).toBe(true);
  });

  it("si el login devuelve un token inválido, muestra error y no entra", async () => {
    loginMock.mockResolvedValue({
      access_token: "no-es-un-jwt",
      refresh_token: "refresh",
      usuario: { id: 1, nombre: "Christopher", correo: "c@test.cl" },
    });

    montar("/login");
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "c@test.cl" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), {
      target: { value: "Clave1234!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(await screen.findByText("No se pudo iniciar sesión. Intenta de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText(/sesión expiró/)).not.toBeInTheDocument();
    expect(ubicacion()).toBe("/login");
    expect(hayTokenGuardado()).toBe(false);
  });
});

describe("Cierre de sesión", () => {
  it("el botón Cerrar sesión borra los tokens, avisa y lleva a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByText("Cerraste sesión.")).toBeInTheDocument();
  });

  it("después de cerrar sesión, volver a una ruta privada no deja entrar", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(ubicacion()).toBe("/login"));

    cleanup();
    montar("/home"); // simula recargar o escribir la URL a mano
    await waitFor(() => expect(ubicacion()).toBe("/login"));
  });

  it("si otra pestaña cierra sesión, esta también vuelve a /login", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");
    await screen.findByText("contenido privado");

    cambioEnOtraPestana(() => logout());

    await waitFor(() => expect(ubicacion()).toBe("/login"));
  });
});

describe("Respuestas que llegan tarde y cambios de cuenta", () => {
  const OTRA: Usuario = { ...USUARIO, id: "2", nombre: "Andrea", plan: "gratuito" };

  it("si en otra pestaña entra otra cuenta, se muestra el usuario nuevo", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValueOnce(USUARIO).mockResolvedValueOnce(OTRA);
    montar("/dashboard");
    expect(await screen.findByText("Christopher")).toBeInTheDocument();

    cambioEnOtraPestana(() => guardarSesion(Date.now() + 25 * 60_000));

    expect(await screen.findByText("Andrea")).toBeInTheDocument();
    expect(screen.queryByText("Christopher")).not.toBeInTheDocument();
  });

  it("un cambio de otra clave de localStorage (p. ej. el tema) no recarga el usuario", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    montar("/dashboard");
    await screen.findByText("Christopher");

    cambioEnOtraPestana(() => localStorage.setItem("oag-tema", "oscuro"));

    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);
  });

  it("la respuesta tardía de la sesión anterior no pisa al usuario nuevo", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    const vieja = diferida<Usuario>();
    const nueva = diferida<Usuario>();
    getUsuarioActualMock
      .mockReturnValueOnce(vieja.promesa)
      .mockReturnValueOnce(nueva.promesa);
    montar("/dashboard");

    // Con /usuarios/me/ todavía pendiente, en otra pestaña se cierra sesión
    // y entra otra cuenta.
    cambioEnOtraPestana(() => logout());
    cambioEnOtraPestana(() => guardarSesion(Date.now() + 30 * 60_000));

    await act(async () => nueva.resolver(OTRA));
    expect(await screen.findByText("Andrea")).toBeInTheDocument();

    await act(async () => vieja.resolver(USUARIO)); // llega tarde
    expect(screen.getByText("Andrea")).toBeInTheDocument();
    expect(screen.queryByText("Christopher")).not.toBeInTheDocument();
  });

  it("un 401 tardío de la sesión anterior no cierra la sesión nueva", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    const vieja = diferida<Usuario>();
    getUsuarioActualMock.mockReturnValueOnce(vieja.promesa).mockResolvedValueOnce(OTRA);
    montar("/dashboard");

    cambioEnOtraPestana(() => logout());
    cambioEnOtraPestana(() => guardarSesion(Date.now() + 30 * 60_000));
    expect(await screen.findByText("Andrea")).toBeInTheDocument();

    await act(async () => vieja.rechazar(new ErrorDeApi("Token inválido", 404)));

    expect(ubicacion()).toBe("/dashboard");
    expect(hayTokenGuardado()).toBe(true);
    expect(screen.getByText("Andrea")).toBeInTheDocument();
  });
});

describe("Cierre de sesión con revocación en el backend (CH-03)", () => {
  it("revoca en el backend ANTES de borrar los tokens locales", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    let habiaTokensAlRevocar = false;
    revocarSesionMock.mockImplementation(async () => {
      habiaTokensAlRevocar = hayTokenGuardado(); // el backend necesita el refresh token
      return true;
    });
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(revocarSesionMock).toHaveBeenCalledTimes(1);
    expect(habiaTokensAlRevocar).toBe(true);
    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByText("Cerraste sesión.")).toBeInTheDocument();
  });

  it("si la revocación falla, igual cierra la sesión local y avisa el error", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    revocarSesionMock.mockResolvedValue(false);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(hayTokenGuardado()).toBe(false);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Cerraste sesión en este equipo, pero no pudimos confirmarlo con el servidor.",
    );
    expect(screen.queryByText("Cerraste sesión.")).not.toBeInTheDocument();
  });

  it("mientras revoca, el botón queda deshabilitado y un doble clic no revoca dos veces", async () => {
    guardarSesion(Date.now() + 30 * 60_000);
    getUsuarioActualMock.mockResolvedValue(USUARIO);
    const revocacion = diferida<boolean>();
    revocarSesionMock.mockReturnValue(revocacion.promesa);
    montar("/dashboard");

    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    const boton = screen.getByRole("button", { name: /Cerrando sesión/ });
    expect(boton).toBeDisabled();
    fireEvent.click(boton);
    expect(ubicacion()).toBe("/dashboard"); // sigue dentro hasta que responda

    await act(async () => revocacion.resolver(true));

    await waitFor(() => expect(ubicacion()).toBe("/login"));
    expect(revocarSesionMock).toHaveBeenCalledTimes(1);
  });
});

describe("Reintento de /usuarios/me/ ante errores temporales (CH-02)", () => {
  // Con timers falsos se controla el paso del tiempo; por eso estos tests no
  // usan waitFor/findBy (que esperan con timers) y avanzan el reloj a mano.
  const avanzar = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

  beforeEach(() => {
    vi.useFakeTimers();
    guardarSesion(Date.now() + 30 * 60_000);
  });

  it("si falla la red, reintenta solo a los 2 s y recupera el usuario sin pedir login", async () => {
    getUsuarioActualMock
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(USUARIO);
    montar("/dashboard");
    await avanzar(0);

    // Sigue dentro, aún sin los datos del usuario.
    expect(screen.getByText("contenido privado")).toBeInTheDocument();
    expect(screen.getByText("Usuario")).toBeInTheDocument();
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);

    await avanzar(1_999);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);
    await avanzar(1);

    expect(getUsuarioActualMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Christopher")).toBeInTheDocument();
    expect(ubicacion()).toBe("/dashboard");
    expect(hayTokenGuardado()).toBe(true);
  });

  it("con 500 sigue un backoff exponencial (2 s, luego 4 s)", async () => {
    getUsuarioActualMock
      .mockRejectedValueOnce(new ErrorDeApi("Error interno", 500))
      .mockRejectedValueOnce(new ErrorDeApi("Error interno", 503))
      .mockResolvedValueOnce(USUARIO);
    montar("/dashboard");
    await avanzar(2_000);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(2);

    await avanzar(3_999);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(2);
    await avanzar(1);

    expect(getUsuarioActualMock).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Christopher")).toBeInTheDocument();
  });

  it("tras 5 reintentos deja de insistir y vuelve a probar cuando vuelve la conexión", async () => {
    getUsuarioActualMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/dashboard");
    await avanzar(2_000 + 4_000 + 8_000 + 16_000 + 30_000);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(6); // 1 intento + 5 reintentos

    await avanzar(120_000);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(6);

    getUsuarioActualMock.mockResolvedValue(USUARIO);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    await avanzar(0);

    expect(getUsuarioActualMock).toHaveBeenCalledTimes(7);
    expect(screen.getByText("Christopher")).toBeInTheDocument();
  });

  it("un 403 no se reintenta (reintentar no lo arregla), pero tampoco echa al usuario", async () => {
    getUsuarioActualMock.mockRejectedValue(new ErrorDeApi("Sin permiso", 403));
    montar("/dashboard");
    await avanzar(60_000);

    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("contenido privado")).toBeInTheDocument();
  });

  it("cerrar sesión corta los reintentos pendientes", async () => {
    getUsuarioActualMock.mockRejectedValue(new TypeError("Failed to fetch"));
    montar("/dashboard");
    await avanzar(0);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await avanzar(0);
    expect(ubicacion()).toBe("/login");

    await avanzar(60_000);
    expect(getUsuarioActualMock).toHaveBeenCalledTimes(1);
  });
});
