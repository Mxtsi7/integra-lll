// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  actualizarSuscripcion,
  cancelarSuscripcion,
  crearSuscripcion,
  ErrorDeApi,
  getCatalogosSuscripciones,
  getSuscripciones,
  guardarTokens,
  reactivarSuscripcion,
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
    cancelarSuscripcion: vi.fn(),
    reactivarSuscripcion: vi.fn(),
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
  vi.mocked(cancelarSuscripcion).mockReset();
  vi.mocked(reactivarSuscripcion).mockReset();
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


describe("Filtros, orden y limpiar en Inicio (CH-11, CH-12, CH-13)", () => {
  const sus = (nombre: string, extra: Partial<Suscripcion> = {}): Suscripcion => ({
    ...SPOTIFY,
    id: `id-${nombre}`,
    nombre,
    ...extra,
  });
  /** Nombres de las tarjetas visibles, en el orden en que se ven. */
  const nombresEnGrilla = () =>
    screen.queryAllByRole("button", { name: /^Ver / }).map((b) => (b.getAttribute("aria-label") ?? "").replace(/^Ver /, ""));
  /** La última consulta CON filtros u orden (la lista completa del resumen se pide sin consulta). */
  const ultimaConsulta = () =>
    vi.mocked(getSuscripciones).mock.calls.map((c) => c[0]).filter((c) => c !== undefined).at(-1);
  const chip = (nombre: RegExp) =>
    within(screen.getByRole("group", { name: "Filtrar por estado" })).getByRole("button", { name: nombre });
  const parametro = (router: Awaited<ReturnType<typeof montar>>, nombre: string) =>
    new URLSearchParams(router.state.location.search).get(nombre);
  const clic = (elemento: HTMLElement) => act(async () => fireEvent.click(elemento));
  const cambiar = (elemento: HTMLElement, value: string) =>
    act(async () => fireEvent.change(elemento, { target: { value } }));
  const fechaDeCobro = () => screen.getByLabelText("Fecha de cobro");
  const ordenarPor = () => screen.getByLabelText("Ordenar por");
  const buscador = () => screen.getByRole("searchbox", { name: "Buscar una suscripción" });
  const paginaActual = () =>
    within(screen.getByRole("navigation", { name: "Paginación de suscripciones" })).getByRole("button", {
      current: "page",
    });

  /** Promesa que el test resuelve cuando quiere. */
  function diferida<T>() {
    let resolver!: (v: T) => void;
    const promesa = new Promise<T>((res) => (resolver = res));
    return { promesa, resolver };
  }

  describe("CH-11: estado y fecha de cobro", () => {
    it("estado y fecha juntos van a la API y la grilla muestra justo lo que devuelve", async () => {
      const NETFLIX = sus("Netflix", { estado: "cancelado", fecha_proximo_cobro: "2026-11-10" });
      const HBO = sus("HBO", { estado: "cancelado", fecha_proximo_cobro: "2026-12-01" });
      vi.mocked(getSuscripciones).mockImplementation(async (c) => {
        if (c?.estado === "cancelado" && c.fecha_cobro === "2026-11-10") return [NETFLIX];
        if (c?.estado === "cancelado") return [NETFLIX, HBO];
        return [SPOTIFY, NETFLIX, HBO];
      });
      const router = await montar();

      await clic(chip(/^Canceladas/));
      expect(nombresEnGrilla()).toEqual(["Netflix", "HBO"]);
      await cambiar(fechaDeCobro(), "2026-11-10");

      expect(ultimaConsulta()).toEqual({ estado: "cancelado", fecha_cobro: "2026-11-10", orden: "fecha_proximo_cobro" });
      expect(nombresEnGrilla()).toEqual(["Netflix"]);
      expect(chip(/^Canceladas/)).toHaveAttribute("aria-pressed", "true");
      expect(parametro(router, "estado")).toBe("cancelado");
      expect(parametro(router, "fecha_cobro")).toBe("2026-11-10");
    });

    it("cambiar de filtro en la página 2 vuelve a la 1 y, mientras carga, no muestra la consulta anterior", async () => {
      const activas = Array.from({ length: 12 }, (_, i) => sus(`Activa ${i + 1}`));
      const canceladas = Array.from({ length: 10 }, (_, i) => sus(`Cancelada ${i + 1}`, { estado: "cancelado" }));
      const respuesta = diferida<Suscripcion[]>();
      vi.mocked(getSuscripciones).mockImplementation((c) =>
        c?.estado === "cancelado" ? respuesta.promesa : Promise.resolve([...activas, ...canceladas]),
      );
      await montar();
      await clic(screen.getByRole("button", { name: "2" }));
      expect(paginaActual()).toHaveTextContent("2");

      await clic(chip(/^Canceladas/));
      // Ni las tarjetas ni la paginación de la consulta anterior.
      expect(nombresEnGrilla()).toEqual([]);
      expect(screen.queryByRole("navigation", { name: "Paginación de suscripciones" })).not.toBeInTheDocument();

      await act(async () => respuesta.resolver(canceladas));
      expect(nombresEnGrilla()).toEqual(canceladas.slice(0, 9).map((s) => s.nombre));
      expect(paginaActual()).toHaveTextContent("1");
    });

    it("una respuesta tardía de un filtro anterior no pisa la del filtro actual", async () => {
      const lenta = diferida<Suscripcion[]>();
      vi.mocked(getSuscripciones).mockImplementation((c) => {
        if (c?.estado === "fantasma") return lenta.promesa;
        if (c?.estado === "cancelado") return Promise.resolve([sus("HBO", { estado: "cancelado" })]);
        return Promise.resolve([SPOTIFY, sus("Gimnasio", { estado: "fantasma" }), sus("HBO", { estado: "cancelado" })]);
      });
      await montar();

      await clic(chip(/^Sin uso/));
      await clic(chip(/^Canceladas/));
      await act(async () => lenta.resolver([sus("Gimnasio", { estado: "fantasma" })]));

      expect(nombresEnGrilla()).toEqual(["HBO"]);
      expect(chip(/^Canceladas/)).toHaveAttribute("aria-pressed", "true");
    });

    it("los filtros viven en la URL: al ir a otra página y volver siguen puestos", async () => {
      const router = await montar(["/home?estado=cancelado&fecha_cobro=2026-11-10&orden=-monto"]);

      expect(ultimaConsulta()).toEqual({ estado: "cancelado", fecha_cobro: "2026-11-10", orden: "-monto" });
      // El estado elegido se ve aunque hoy no haya ninguna cancelada.
      expect(chip(/^Canceladas/)).toHaveAttribute("aria-pressed", "true");
      expect(fechaDeCobro()).toHaveValue("2026-11-10");
      expect(ordenarPor()).toHaveValue("-monto");

      await navegar(router, "/perfil");
      await navegar(router, -1);

      expect(chip(/^Canceladas/)).toHaveAttribute("aria-pressed", "true");
      expect(fechaDeCobro()).toHaveValue("2026-11-10");
      expect(ultimaConsulta()).toEqual({ estado: "cancelado", fecha_cobro: "2026-11-10", orden: "-monto" });
    });

    it("buscar desde la barra superior no borra los filtros ni el orden", async () => {
      const router = await montar(["/home?estado=activo&orden=nombre"]);

      await cambiar(buscador(), "spo");

      expect(parametro(router, "q")).toBe("spo");
      expect(parametro(router, "estado")).toBe("activo");
      expect(parametro(router, "orden")).toBe("nombre");
      expect(nombresEnGrilla()).toEqual(["Spotify"]);
    });
  });

  describe("CH-12: ordenar", () => {
    it("por defecto pide el cobro más cercano primero y el selector lo indica", async () => {
      await montar();

      expect(ultimaConsulta()).toEqual({ orden: "fecha_proximo_cobro" });
      expect(ordenarPor()).toHaveDisplayValue("Próximo cobro: más cercano primero");
    });

    it("el orden lo aplica la API antes de paginar: la página 2 sigue el mismo orden", async () => {
      // A propósito sin ningún orden reconocible: si la web reordenara la página, se notaría.
      const deMayorAMenor = ["Kappa", "Alfa", "Zeta", "Beta", "Omega", "Delta", "Mu", "Gamma", "Rho", "Iota", "Chi", "Eta"].map(
        (nombre, i) => sus(nombre, { monto: 12_000 - i * 1_000 }),
      );
      vi.mocked(getSuscripciones).mockImplementation(async (c) =>
        c?.orden === "-monto" ? deMayorAMenor : [...deMayorAMenor].reverse(),
      );
      const router = await montar();

      await cambiar(ordenarPor(), "-monto");

      expect(ultimaConsulta()).toEqual({ orden: "-monto" });
      expect(parametro(router, "orden")).toBe("-monto");
      expect(ordenarPor()).toHaveDisplayValue("Monto: de mayor a menor");
      expect(nombresEnGrilla()).toEqual(deMayorAMenor.slice(0, 9).map((s) => s.nombre));
      await clic(screen.getByRole("button", { name: "Página siguiente" }));
      expect(nombresEnGrilla()).toEqual(["Iota", "Chi", "Eta"]);
    });

    it("un estado, fecha u orden inventados en la URL no llegan a la API", async () => {
      await montar(["/home?estado=borrado&fecha_cobro=2026-02-30&orden=password"]);

      const consultas = vi.mocked(getSuscripciones).mock.calls.map((c) => c[0]).filter((c) => c !== undefined);
      expect(consultas.length).toBeGreaterThan(0);
      for (const consulta of consultas) expect(consulta).toEqual({ orden: "fecha_proximo_cobro" });
      expect(chip(/^Todas/)).toHaveAttribute("aria-pressed", "true");
      expect(fechaDeCobro()).toHaveValue("");
    });
  });

  describe("CH-13: limpiar filtros y sin coincidencias", () => {
    it("Limpiar filtros vuelve a todas, sin fecha, el orden predeterminado, sin búsqueda y a la página 1", async () => {
      const doce = Array.from({ length: 12 }, (_, i) => sus(`Activa ${i + 1}`));
      vi.mocked(getSuscripciones).mockResolvedValue(doce);
      const router = await montar(["/home?estado=activo&fecha_cobro=2026-11-10&orden=-monto&q=Activa"]);
      await clic(screen.getByRole("button", { name: "2" }));

      await clic(screen.getByRole("button", { name: "Limpiar filtros" }));

      expect(router.state.location.search).toBe("");
      expect(ultimaConsulta()).toEqual({ orden: "fecha_proximo_cobro" });
      expect(chip(/^Todas/)).toHaveAttribute("aria-pressed", "true");
      expect(fechaDeCobro()).toHaveValue("");
      expect(ordenarPor()).toHaveValue("fecha_proximo_cobro");
      expect(buscador()).toHaveValue("");
      expect(paginaActual()).toHaveTextContent("1");
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("sin coincidencias dice que nada coincide y ofrece limpiar, sin invitar a crear la primera", async () => {
      vi.mocked(getSuscripciones).mockImplementation(async (c) => (c?.estado === "cancelado" ? [] : [SPOTIFY]));
      await montar(["/home?estado=cancelado&q=net&fecha_cobro=2026-11-10"]);

      const aviso = screen.getByRole("heading", { name: "Ninguna suscripción coincide" }).closest("section")!;
      expect(aviso).toHaveTextContent(
        "No hay suscripciones en Canceladas, con «net» en el nombre y con cobro el 10 nov 2026.",
      );
      expect(within(aviso).getByRole("button")).toHaveTextContent("Limpiar filtros");
      expect(screen.queryByText(/Todavía no registras/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Agrega la primera/)).not.toBeInTheDocument();

      await clic(within(aviso).getByRole("button", { name: "Limpiar filtros" }));
      expect(nombresEnGrilla()).toEqual(["Spotify"]);
      expect(screen.queryByText("Ninguna suscripción coincide")).not.toBeInTheDocument();
    });

    it("una cuenta sin suscripciones sigue invitando a agregar la primera, aunque la URL traiga filtros", async () => {
      vi.mocked(getSuscripciones).mockResolvedValue([]);
      await montar(["/home?estado=cancelado"]);

      expect(screen.getByRole("heading", { name: "Todavía no registras suscripciones" })).toBeInTheDocument();
      expect(screen.queryByText("Ninguna suscripción coincide")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });

    it("sin filtros ni búsqueda no aparece Limpiar filtros", async () => {
      await montar();
      expect(screen.queryByRole("button", { name: "Limpiar filtros" })).not.toBeInTheDocument();
    });
  });

  it("al crear con filtros puestos, se quitan estado y fecha y se ve la página donde quedó la nueva", async () => {
    const doce = Array.from({ length: 12 }, (_, i) => sus(`Activa ${i + 1}`));
    const NUEVA = sus("Netflix", { id: "nueva" });
    let creada = false;
    vi.mocked(getSuscripciones).mockImplementation(async () =>
      creada ? [...doce.slice(0, 10), NUEVA, ...doce.slice(10)] : doce,
    );
    vi.mocked(crearSuscripcion).mockImplementation(async () => {
      creada = true;
      return NUEVA;
    });
    const router = await montar(["/home?estado=activo&fecha_cobro=2026-11-10&orden=nombre"]);

    abrirNueva();
    fireEvent.change(enDialogo().getByLabelText("Servicio"), { target: { value: "Netflix" } });
    fireEvent.change(enDialogo().getByLabelText("Monto"), { target: { value: "9990" } });
    fireEvent.change(enDialogo().getByLabelText("Próximo cobro"), { target: { value: "2026-11-05" } });
    await act(async () => {
      fireEvent.click(enDialogo().getByRole("button", { name: "Guardar suscripción" }));
    });

    expect(parametro(router, "estado")).toBeNull();
    expect(parametro(router, "fecha_cobro")).toBeNull();
    expect(parametro(router, "orden")).toBe("nombre"); // el orden elegido se respeta
    expect(paginaActual()).toHaveTextContent("2");
    expect(nombresEnGrilla()).toContain("Netflix");
  });
});

describe("Interruptor de seguimiento en las tarjetas", () => {
  const NETFLIX: Suscripcion = { ...SPOTIFY, id: "s2", nombre: "Netflix", monto: 9990, estado: "cancelado" };
  const TOKEN_B = (() => {
    const b64 = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const claims = { user_id: 8, organizacion_id: "org-b", sid: "sesion-b", jti: "b-1", exp: Math.floor(Date.now() / 1000) + 1800 };
    return `${b64({ alg: "HS256" })}.${b64(claims)}.firma`;
  })();

  /** Lo que tiene el servidor: las lecturas lo filtran y cancelar o reactivar lo cambian. */
  let servidor: Suscripcion[];
  function leerServidor(estado?: Suscripcion["estado"]) {
    return servidor.filter((s) => !estado || s.estado === estado).map((s) => ({ ...s }));
  }
  function aplicar(id: string, estado: Suscripcion["estado"]) {
    servidor = servidor.map((s) => (s.id === id ? { ...s, estado } : s));
    return { ...servidor.find((s) => s.id === id)! };
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

  const interruptor = (nombre: string) =>
    screen.getByRole("switch", { name: `Seguimiento de cobros de ${nombre}`, hidden: true });
  const chip = (nombre: RegExp) =>
    within(screen.getByRole("group", { name: "Filtrar por estado", hidden: true })).queryByRole("button", {
      name: nombre,
      hidden: true,
    });
  const alMes = () => within(screen.getByRole("region", { name: "Resumen", hidden: true })).getAllByText(/^\$/)[0];
  const clic = (elemento: HTMLElement) => act(async () => fireEvent.click(elemento));
  // La confirmación de cancelar es una alerta (role="alertdialog").
  const alerta = () => screen.queryByRole("alertdialog");
  const enAlerta = () => within(screen.getByRole("alertdialog"));
  const confirmar = () => enAlerta().getByRole("button", { name: /Cancelar suscripción|Cancelando/ });

  beforeEach(() => {
    servidor = [{ ...SPOTIFY }, { ...NETFLIX }];
    vi.mocked(getSuscripciones).mockImplementation(async (c) => leerServidor(c?.estado));
    vi.mocked(cancelarSuscripcion).mockImplementation(async (id) => aplicar(id, "cancelado"));
    vi.mocked(reactivarSuscripcion).mockImplementation(async (id) => aplicar(id, "activo"));
  });

  it("apagar pide confirmar, aclara lo del proveedor, y «Volver» no manda nada", async () => {
    const router = await montar();
    await clic(interruptor("Spotify"));

    expect(router.state.location.pathname).toBe("/home"); // no abrió el detalle
    expect(screen.getByRole("alertdialog", { name: "¿Cancelar Spotify?" })).toBeInTheDocument();
    expect(enAlerta().getByText(/cancela el servicio con su proveedor/)).toBeInTheDocument();

    await clic(enAlerta().getByRole("button", { name: "Volver" }));
    expect(alerta()).not.toBeInTheDocument();
    expect(cancelarSuscripcion).not.toHaveBeenCalled();
    expect(reactivarSuscripcion).not.toHaveBeenCalled();
    expect(interruptor("Spotify")).toHaveAttribute("aria-checked", "true");
  });

  it("confirmar cancela una sola vez aunque se pulse dos veces, y el resultado sobrevive a la recarga", async () => {
    const pendiente = diferida<Suscripcion>();
    vi.mocked(cancelarSuscripcion).mockReturnValueOnce(pendiente.promesa);
    await montar();
    expect(alMes()).toHaveTextContent("$5.990");
    await clic(interruptor("Spotify"));

    // Los dos clics en el mismo instante, antes de que React vuelva a dibujar:
    // el botón todavía no está deshabilitado y solo la reserva los separa.
    await act(async () => {
      const boton = confirmar();
      fireEvent.click(boton);
      fireEvent.click(boton);
    });
    expect(cancelarSuscripcion).toHaveBeenCalledTimes(1);
    expect(cancelarSuscripcion).toHaveBeenCalledWith("s1");
    expect(actualizarSuscripcion).not.toHaveBeenCalled();
    // Mientras viaja: la tarjeta dice "Guardando…" y no se puede editar ni eliminar.
    expect(interruptor("Spotify")).toHaveAccessibleDescription("Guardando…");
    expect(screen.getByRole("button", { name: "Editar Spotify", hidden: true })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar Spotify", hidden: true })).toBeDisabled();
    expect(confirmar()).toHaveTextContent("Cancelando…");

    const lecturasAntes = vi.mocked(getSuscripciones).mock.calls.length;
    await act(async () => pendiente.resolver(aplicar("s1", "cancelado")));

    expect(alerta()).not.toBeInTheDocument();
    expect(interruptor("Spotify")).toHaveAttribute("aria-checked", "false");
    expect(interruptor("Spotify")).toHaveAccessibleDescription("Cancelada");
    expect(screen.getByText("Cancelaste Spotify. Ya no contamos sus próximos cobros.")).toBeInTheDocument();
    // Conteos y gasto salen de la respuesta: ya no hay activas ni gasto al mes.
    expect(chip(/^Activas/)).toBeNull();
    expect(chip(/^Canceladas/)).toHaveTextContent("2");
    expect(alMes()).toHaveTextContent("$0");
    // Se volvió a pedir la lista y sigue cancelada.
    expect(vi.mocked(getSuscripciones).mock.calls.length).toBeGreaterThan(lecturasAntes);
    expect(interruptor("Spotify")).toHaveAttribute("aria-checked", "false");
  });

  it("con el filtro Activas, la cancelada sale de la grilla sin esperar la recarga", async () => {
    servidor = [{ ...SPOTIFY }, { ...NETFLIX, estado: "activo" }];
    await montar(["/dashboard", "/home?estado=activo"]);
    // La recarga posterior al cambio no llega nunca.
    vi.mocked(getSuscripciones).mockImplementation(() => new Promise(() => {}));

    await clic(interruptor("Spotify"));
    await clic(confirmar());

    expect(screen.queryByRole("switch", { name: "Seguimiento de cobros de Spotify" })).not.toBeInTheDocument();
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "true");
    expect(chip(/^Activas/)).toHaveTextContent("1");
  });

  it("prender reactiva enseguida, sin confirmar, y un doble clic manda una sola", async () => {
    const pendiente = diferida<Suscripcion>();
    vi.mocked(reactivarSuscripcion).mockReturnValueOnce(pendiente.promesa);
    await montar();

    await act(async () => {
      const control = interruptor("Netflix");
      fireEvent.click(control);
      fireEvent.click(control);
    });
    expect(alerta()).not.toBeInTheDocument();
    expect(reactivarSuscripcion).toHaveBeenCalledTimes(1);
    expect(reactivarSuscripcion).toHaveBeenCalledWith("s2");
    expect(cancelarSuscripcion).not.toHaveBeenCalled();
    expect(interruptor("Netflix")).toHaveAttribute("aria-disabled", "true");

    await act(async () => pendiente.resolver(aplicar("s2", "activo")));
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "true");
    expect(interruptor("Netflix")).toHaveAccessibleDescription("Activa");
    expect(interruptor("Netflix")).not.toHaveAttribute("aria-disabled");
    expect(screen.getByText("Reactivaste Netflix. Volvemos a contar sus cobros.")).toBeInTheDocument();
    expect(chip(/^Activas/)).toHaveTextContent("2");
  });

  it("si cancelar falla, la confirmación lo dice, nada cambia y se puede reintentar", async () => {
    vi.mocked(cancelarSuscripcion).mockRejectedValueOnce(new ErrorDeApi("Error interno.", 500));
    await montar();
    await clic(interruptor("Spotify"));
    await clic(confirmar());

    expect(enAlerta().getByRole("alert")).toHaveTextContent("No pudimos cancelar la suscripción. Intenta de nuevo.");
    expect(interruptor("Spotify")).toHaveAttribute("aria-checked", "true");
    expect(chip(/^Activas/)).toHaveTextContent("1");

    await clic(confirmar());
    expect(cancelarSuscripcion).toHaveBeenCalledTimes(2);
    expect(alerta()).not.toBeInTheDocument();
    expect(interruptor("Spotify")).toHaveAttribute("aria-checked", "false");
  });

  it("si reactivar falla, avisa con el motivo, queda apagada y se puede reintentar", async () => {
    vi.mocked(reactivarSuscripcion).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await montar();
    await clic(interruptor("Netflix"));

    expect(screen.getByText("No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.")).toBeInTheDocument();
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "false");
    expect(interruptor("Netflix")).toHaveAccessibleDescription("Cancelada");

    await clic(interruptor("Netflix"));
    expect(reactivarSuscripcion).toHaveBeenCalledTimes(2);
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "true");
  });

  it("un 404 avisa que ya no existe y vuelve a pedir la lista", async () => {
    await montar();
    servidor = servidor.filter((s) => s.id !== "s2"); // la eliminaron en otro lado
    vi.mocked(reactivarSuscripcion).mockRejectedValueOnce(new ErrorDeApi("No encontrado.", 404));
    await clic(interruptor("Netflix"));

    expect(screen.getByText("Esta suscripción ya no existe. Actualizamos tu lista.")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Seguimiento de cobros de Netflix" })).not.toBeInTheDocument();
    expect(chip(/^Todas/)).toHaveTextContent("1");
  });

  it("si el cambio se guardó pero la lista no se pudo actualizar, lo dice así", async () => {
    await montar();
    vi.mocked(getSuscripciones).mockRejectedValue(new TypeError("Failed to fetch"));
    await clic(interruptor("Netflix"));

    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Guardamos el cambio, pero no pudimos actualizar la lista. Intenta de nuevo.",
    );
  });

  it("la lista completa que salió antes del cambio no pisa los conteos nuevos", async () => {
    const HBO: Suscripcion = { ...NETFLIX, id: "s3", nombre: "HBO" };
    servidor = [{ ...SPOTIFY }, { ...NETFLIX }, { ...HBO }];
    await montar();

    // Un 404 en HBO vuelve a pedir la lista completa, y esa lectura se demora.
    const vieja = diferida<Suscripcion[]>();
    vi.mocked(getSuscripciones).mockImplementation(async (c) => (c === undefined ? vieja.promesa : leerServidor(c?.estado)));
    servidor = servidor.filter((s) => s.id !== "s3");
    vi.mocked(reactivarSuscripcion).mockRejectedValueOnce(new ErrorDeApi("No encontrado.", 404));
    await clic(interruptor("HBO"));

    // Mientras tanto se reactiva Netflix: la lectura en vuelo es de antes.
    await clic(interruptor("Netflix"));
    expect(chip(/^Activas/)).toHaveTextContent("2");

    vi.mocked(getSuscripciones).mockImplementation(async (c) => leerServidor(c?.estado));
    await act(async () => vieja.resolver([{ ...SPOTIFY }, { ...NETFLIX }]));
    expect(chip(/^Activas/)).toHaveTextContent("2");
    expect(chip(/^Canceladas/)).toBeNull();
    expect(chip(/^Todas/)).toHaveTextContent("2");
  });

  it("una lectura de la grilla que llega junto con el cambio no lo pisa", async () => {
    const cambio = diferida<Suscripcion>();
    vi.mocked(reactivarSuscripcion).mockReturnValueOnce(cambio.promesa);
    await montar();
    await clic(interruptor("Netflix"));

    // Mientras se reactiva, se cambia el orden: esa lectura sale con Netflix cancelada.
    const lectura = diferida<Suscripcion[]>();
    const recarga = diferida<Suscripcion[]>();
    vi.mocked(getSuscripciones).mockReturnValueOnce(lectura.promesa);
    await act(async () => fireEvent.change(screen.getByLabelText("Ordenar por"), { target: { value: "nombre" } }));
    vi.mocked(getSuscripciones).mockReturnValue(recarga.promesa);

    // Llegan juntas: primero la respuesta del cambio, después la lectura vieja.
    await act(async () => {
      cambio.resolver(aplicar("s2", "activo"));
      lectura.resolver([{ ...NETFLIX }, { ...SPOTIFY }]);
    });
    expect(screen.queryByText("Cancelada")).not.toBeInTheDocument();

    await act(async () => recarga.resolver(leerServidor()));
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "true");
  });

  it("si la sesión cambia mientras se espera, el resultado no se aplica ni se opera con la nueva cuenta", async () => {
    const pendiente = diferida<Suscripcion>();
    vi.mocked(reactivarSuscripcion).mockReturnValueOnce(pendiente.promesa);
    await montar();
    await clic(interruptor("Netflix"));

    // Otra pestaña entra con otra cuenta: a esta solo le llega el evento `storage`.
    await act(async () => {
      guardarTokens({ access_token: TOKEN_B, refresh_token: "refresh-b" });
      window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
    });
    await act(async () => pendiente.resolver(aplicar("s2", "activo")));
    expect(screen.queryByText(/Reactivaste/)).not.toBeInTheDocument();
    expect(interruptor("Netflix")).toHaveAttribute("aria-checked", "false");

    // Con la sesión ya cambiada, el interruptor no pide nada con el token nuevo.
    await clic(interruptor("Spotify"));
    expect(alerta()).not.toBeInTheDocument();
    expect(cancelarSuscripcion).not.toHaveBeenCalled();
  });

  it("si se sale de Inicio mientras se espera, la respuesta no hace nada", async () => {
    const pendiente = diferida<Suscripcion>();
    vi.mocked(reactivarSuscripcion).mockReturnValueOnce(pendiente.promesa);
    const router = await montar();
    await clic(interruptor("Netflix"));

    await navegar(router, "/dashboard");
    await act(async () => pendiente.resolver(aplicar("s2", "activo")));
    expect(screen.getByRole("heading", { name: "Panel de prueba" })).toBeInTheDocument();
    expect(screen.queryByText(/Reactivaste/)).not.toBeInTheDocument();
  });
});
