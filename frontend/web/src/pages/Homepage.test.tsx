// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actualizarSuscripcion,
  crearSuscripcion,
  ErrorDeApi,
  getCatalogosSuscripciones,
  getSuscripciones,
  type CatalogosSuscripciones,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { CatalogosProvider } from "../context/CatalogosContext";
import { ToastProvider } from "../context/ToastContext";
import { AuthProvider } from "../context/AuthContext";
import Homepage from "./Homepage";

// Solo se simula la red; la página, los formularios y el modal son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getSuscripciones: vi.fn(),
    getCatalogosSuscripciones: vi.fn(),
    crearSuscripcion: vi.fn(),
    actualizarSuscripcion: vi.fn(),
  };
});

const SPOTIFY: Suscripcion = {
  id: "s1",
  nombre: "Spotify",
  monto: 5990,
  moneda: "CLP",
  frecuencia: "mensual",
  fecha_proximo_cobro: "2026-11-10",
  categoria: "musica",
  estado: "activo",
};

// Las opciones de los formularios vienen del catálogo del backend (como en la app).
const opcion = (codigo: string, nombre: string) => ({ codigo, nombre, activo: true, orden: 1 });
const CATALOGO: CatalogosSuscripciones = {
  monedas: [opcion("CLP", "Peso chileno"), opcion("USD", "Dólar")],
  categorias: [opcion("otro", "Otro"), opcion("musica", "Música")],
  frecuencias: [{ codigo: "mensual", nombre: "Mensual" }, { codigo: "anual", nombre: "Anual" }],
  predeterminados: { moneda: "CLP", categoria: "otro", frecuencia: "mensual" },
};

function Pagina({ titulo }: { titulo: string }) {
  return <h1>{titulo}</h1>;
}

/**
 * Monta Inicio dentro de un data router en memoria, como main.tsx (que usa
 * createBrowserRouter): useBlocker solo funciona en un data router. Por
 * defecto el historial es [/dashboard, /home] y se está en /home, así
 * "Atrás" tiene a dónde ir.
 */
async function montar(entradas = ["/dashboard", "/home"], indice = entradas.length - 1) {
  const router = createMemoryRouter(
    [
      { path: "/home", element: <Homepage /> },
      { path: "/dashboard", element: <Pagina titulo="Panel de prueba" /> },
      { path: "/perfil", element: <Pagina titulo="Perfil de prueba" /> },
    ],
    { initialEntries: entradas, initialIndex: indice },
  );
  // Con StrictMode, como main.tsx: React ejecuta los efectos dos veces en
  // desarrollo, y así se detectan efectos que no lo soportan.
  render(
    <StrictMode>
      <ToastProvider>
        <AuthProvider>
          {/* En la app, CatalogosLayout envuelve las rutas privadas. */}
          <CatalogosProvider>
            <RouterProvider router={router} />
          </CatalogosProvider>
        </AuthProvider>
      </ToastProvider>
    </StrictMode>,
  );
  await act(async () => {}); // carga inicial de la lista
  return router;
}

/** Navega como lo haría el navegador o un enlace, y espera a que termine. */
async function navegar(router: Awaited<ReturnType<typeof montar>>, destino: string | number) {
  await act(async () => {
    if (typeof destino === "number") await router.navigate(destino);
    else await router.navigate(destino);
  });
}

const dialogo = () => screen.queryByRole("dialog");
const aviso = () => screen.queryByText("Tienes cambios sin guardar. Si sales ahora, se pierden.");
const enDialogo = () => within(screen.getByRole("dialog"));

function abrirNueva() {
  fireEvent.click(screen.getByRole("button", { name: "Agregar suscripción" }));
}

function abrirEdicion() {
  fireEvent.click(screen.getByRole("button", { name: "Editar Spotify" }));
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getSuscripciones).mockReset().mockResolvedValue([SPOTIFY]);
  vi.mocked(getCatalogosSuscripciones).mockReset().mockResolvedValue(structuredClone(CATALOGO));
  vi.mocked(crearSuscripcion).mockReset();
  vi.mocked(actualizarSuscripcion).mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Cambios sin guardar al crear (CH-16)", () => {
  it("un formulario limpio se cierra sin aviso", async () => {
    await montar();
    abrirNueva();
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("con cambios, Cancelar muestra el aviso y no cierra ni pierde lo escrito", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Netflix");
    // El foco va a la opción que no pierde nada.
    expect(document.activeElement).toBe(enDialogo().getByRole("button", { name: "Seguir editando" }));
  });

  it("'Seguir editando' vuelve al formulario con todo lo escrito", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    const cancelar = enDialogo().getByRole("button", { name: "Cancelar" });
    cancelar.focus();
    fireEvent.click(cancelar);
    fireEvent.click(enDialogo().getByRole("button", { name: "Seguir editando" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Netflix");
    expect(document.activeElement).toBe(cancelar); // el foco vuelve a donde estaba
  });

  it("'Descartar cambios' cierra, y al volver a abrir el formulario está vacío", async () => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));

    expect(dialogo()).not.toBeInTheDocument();
    abrirNueva();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("");
    expect(aviso()).not.toBeInTheDocument();
  });

  it.each([
    ["Escape", () => fireEvent.keyDown(document, { key: "Escape" })],
    ["la X", () => fireEvent.click(enDialogo().getByRole("button", { name: "Cerrar" }))],
  ])("con cambios, cerrar con %s también pregunta", async (_, cerrar) => {
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "100" } });
    cerrar();

    expect(aviso()).toBeInTheDocument();
    expect(dialogo()).toBeInTheDocument();
  });

  it("volver a dejar el campo como estaba cuenta como sin cambios", async () => {
    await montar();
    abrirNueva();
    const servicio = enDialogo().getByLabelText("Servicio");
    fireEvent.change(servicio, { target: { value: "Netflix" } });
    fireEvent.change(servicio, { target: { value: "" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).not.toBeInTheDocument();
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("escribir no le quita el foco al campo (el modal no se re-enfoca)", async () => {
    await montar();
    abrirNueva();
    const monto = enDialogo().getByLabelText("Monto");
    monto.focus();
    fireEvent.change(monto, { target: { value: "1" } });
    expect(document.activeElement).toBe(monto);
  });

  it("después de guardar ya no hay aviso: el estado se limpia", async () => {
    vi.mocked(crearSuscripcion).mockResolvedValue({ ...SPOTIFY, id: "s2", nombre: "Netflix" });
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(dialogo()).not.toBeInTheDocument();
    const salir = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(salir);
    expect(salir.defaultPrevented).toBe(false);
  });

  it("con cambios, cerrar o recargar la pestaña pide confirmación; sin cambios, no", async () => {
    await montar();
    abrirNueva();
    const limpio = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(limpio);
    expect(limpio.defaultPrevented).toBe(false);

    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    const conCambios = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(conCambios);
    expect(conCambios.defaultPrevented).toBe(true);
  });
});

describe("Cambios sin guardar al editar (CH-16)", () => {
  it("sin tocar nada se cierra sin aviso", async () => {
    await montar();
    abrirEdicion();
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    expect(dialogo()).not.toBeInTheDocument();
  });

  it("con cambios pregunta; descartar no guarda nada", async () => {
    await montar();
    abrirEdicion();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "6990" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));

    expect(aviso()).toBeInTheDocument();
    fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));

    expect(dialogo()).not.toBeInTheDocument();
    expect(actualizarSuscripcion).not.toHaveBeenCalled();
  });
});

describe("Errores del servidor al crear llegan al formulario (CH-09)", () => {
  it("un 400 del backend se muestra junto al campo correcto", async () => {
    vi.mocked(crearSuscripcion).mockRejectedValue(
      new ErrorDeApi("El monto debe ser mayor a 0.", 400, { monto: ["El monto debe ser mayor a 0."] }),
    );
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(enDialogo().getByLabelText("Monto")).toHaveAttribute("aria-invalid", "true");
    expect(enDialogo().getByText("El monto debe ser mayor a 0.")).toBeInTheDocument();
  });
});

describe("Cambios sin guardar al navegar dentro de la app (CH-16, revisión PR #80)", () => {
  function escribirNueva(nombre: string, monto: string) {
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: nombre } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: monto } });
  }

  it("Atrás con cambios al crear: se retiene, y 'Seguir editando' conserva todos los valores", async () => {
    const router = await montar();
    abrirNueva();
    escribirNueva("Netflix", "9990");

    await navegar(router, -1);

    expect(router.state.location.pathname).toBe("/home"); // no se fue
    expect(aviso()).toBeInTheDocument();
    fireEvent.click(enDialogo().getByRole("button", { name: "Seguir editando" }));

    expect(router.state.location.pathname).toBe("/home");
    expect(aviso()).not.toBeInTheDocument();
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Netflix");
    expect(enDialogo().getByLabelText("Monto")).toHaveValue("9990");
  });

  it("Atrás con cambios al crear: 'Descartar cambios' completa la navegación pendiente", async () => {
    const router = await montar();
    abrirNueva();
    escribirNueva("Netflix", "9990");

    await navegar(router, -1);
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));
    });

    expect(router.state.location.pathname).toBe("/dashboard");
    expect(screen.getByRole("heading", { name: "Panel de prueba" })).toBeInTheDocument();
  });

  it("Adelante con cambios también se retiene", async () => {
    const router = await montar(["/home", "/perfil"], 0);
    abrirNueva();
    escribirNueva("Netflix", "9990");

    await navegar(router, 1);

    expect(router.state.location.pathname).toBe("/home");
    expect(aviso()).toBeInTheDocument();
  });

  it("una navegación interna (enlace o navigate) con cambios también se retiene", async () => {
    const router = await montar();
    abrirNueva();
    escribirNueva("Netflix", "9990");

    await navegar(router, "/perfil");

    expect(router.state.location.pathname).toBe("/home");
    expect(aviso()).toBeInTheDocument();
  });

  it("sin cambios, Atrás navega sin aviso", async () => {
    const router = await montar();
    abrirNueva();

    await navegar(router, -1);

    expect(router.state.location.pathname).toBe("/dashboard");
    expect(aviso()).not.toBeInTheDocument();
  });

  it("Atrás con cambios al editar: se retiene y permanecer conserva los valores; descartar no guarda", async () => {
    const router = await montar();
    abrirEdicion();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "6990" } });

    await navegar(router, -1);
    expect(router.state.location.pathname).toBe("/home");
    fireEvent.click(enDialogo().getByRole("button", { name: "Seguir editando" }));
    // (en edición el monto es type="number": el valor llega como número)
    expect(enDialogo().getByLabelText("Monto")).toHaveValue(6990);
    expect(enDialogo().getByLabelText("Servicio")).toHaveValue("Spotify");

    await navegar(router, -1);
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Descartar cambios" }));
    });
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(actualizarSuscripcion).not.toHaveBeenCalled();
  });

  it("guardar con una navegación retenida la completa: ya no hay nada que perder", async () => {
    vi.mocked(crearSuscripcion).mockResolvedValue({ ...SPOTIFY, id: "s2", nombre: "Netflix" });
    const router = await montar();
    abrirNueva();
    escribirNueva("Netflix", "9990");
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });

    await navegar(router, -1);
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(crearSuscripcion).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe("/dashboard");
  });
});

describe("Guardar con el aviso visible no lo deja pendiente (CH-16, revisión PR #80)", () => {
  it("al crear: modificar → Cancelar → guardar → reabrir, y el formulario nuevo no muestra aviso", async () => {
    vi.mocked(crearSuscripcion).mockResolvedValue({ ...SPOTIFY, id: "s2", nombre: "Netflix" });
    await montar();
    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    expect(aviso()).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });
    expect(dialogo()).not.toBeInTheDocument();

    abrirNueva();
    expect(aviso()).not.toBeInTheDocument();
  });

  it("al editar: modificar → Cancelar → guardar → reabrir, y no queda aviso", async () => {
    vi.mocked(actualizarSuscripcion).mockResolvedValue({ ...SPOTIFY, monto: 6990 });
    await montar();
    abrirEdicion();
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "6990" } });
    fireEvent.click(enDialogo().getByRole("button", { name: "Cancelar" }));
    expect(aviso()).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar cambios" }));
    });
    expect(dialogo()).not.toBeInTheDocument();

    abrirEdicion();
    expect(aviso()).not.toBeInTheDocument();
  });
});
