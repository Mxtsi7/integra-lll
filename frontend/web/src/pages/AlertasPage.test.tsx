// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorDeApi,
  getAlertas,
  getContadorAlertas,
  marcarAlertaLeida,
  marcarTodasLasAlertasLeidas,
  TAMANO_PAGINA_ALERTAS,
  type Alerta,
  type ConsultaAlertas,
  type LecturaAlerta,
  type Paginado,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ContadorAlertasProvider } from "../context/ContadorAlertasContext";
import { ToastProvider } from "../context/ToastContext";
import { AlertasPage } from "./AlertasPage";

// Solo se simula la red: página, componentes, campana y contador son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return {
    ...real,
    getAlertas: vi.fn(),
    getContadorAlertas: vi.fn(),
    marcarAlertaLeida: vi.fn(),
    marcarTodasLasAlertasLeidas: vi.fn(),
  };
});

/** La forma real de AlertaSerializer (FE-19). */
function alerta(n: number, lectura: LecturaAlerta = "pendiente", extra: Partial<Alerta> = {}): Alerta {
  return {
    id: `a${n}`,
    tipo: "proximo_cobro",
    tipo_legible: "Próximo cobro",
    titulo: `Aviso ${n}`,
    mensaje: `Detalle del aviso ${n}.`,
    suscripcion_id: null,
    datos: {},
    lectura,
    lectura_legible: { pendiente: "Pendiente", leida: "Leída", revisada: "Revisada" }[lectura],
    pendiente: lectura === "pendiente",
    leida_en: lectura === "pendiente" ? null : "2026-10-29T10:00:00Z",
    revisada_en: lectura === "revisada" ? "2026-10-29T10:00:00Z" : null,
    // De la más nueva a la más vieja, como el `ordering` del modelo.
    creado_en: new Date(Date.UTC(2026, 9, 30, 12) - n * 3_600_000).toISOString(),
    ...extra,
  };
}

// ── Un servidor en memoria con las reglas de FE-19 y FE-20 ──────────────
let servidor: Alerta[] = [];

function leerServidor({ lectura, pagina = 1 }: ConsultaAlertas = {}): Paginado<Alerta> {
  const filtradas = servidor.filter((a) => !lectura || a.lectura === lectura);
  const desde = (pagina - 1) * TAMANO_PAGINA_ALERTAS;
  // Como el paginador de DRF: una página vacía que no es la primera es 404.
  if (pagina > 1 && desde >= filtradas.length) throw new ErrorDeApi("Página inválida.", 404);
  return {
    count: filtradas.length,
    next: desde + TAMANO_PAGINA_ALERTAS < filtradas.length ? `?page=${pagina + 1}` : null,
    previous: pagina > 1 ? `?page=${pagina - 1}` : null,
    results: filtradas.slice(desde, desde + TAMANO_PAGINA_ALERTAS).map((a) => ({ ...a })),
  };
}

function leerEnServidor(id: string): Alerta {
  const actual = servidor.find((a) => a.id === id);
  if (!actual) throw new ErrorDeApi("No encontrado.", 404);
  if (actual.pendiente) {
    Object.assign(actual, { lectura: "leida", lectura_legible: "Leída", pendiente: false, leida_en: "2026-10-30T15:00:00Z" });
  }
  return { ...actual };
}

const pendientesEnServidor = () => servidor.filter((a) => a.pendiente).length;

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function Proveedores({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthProvider>
        <ContadorAlertasProvider>{children}</ContadorAlertasProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

async function montar(desde = "/alertas") {
  const router = createMemoryRouter(
    [
      {
        path: "/alertas",
        element: (
          <Proveedores>
            <AlertasPage />
          </Proveedores>
        ),
      },
      { path: "/configuracion", element: <p>Ajustes</p> },
      { path: "/suscripciones/:id", element: <p>Detalle de la suscripción</p> },
    ],
    { initialEntries: [desde] },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await act(async () => {});
  return router;
}

const clic = (el: HTMLElement) => act(async () => fireEvent.click(el));
const lista = () => screen.queryByRole("list", { name: "Alertas" });
const titulos = () =>
  within(screen.getByRole("list", { name: "Alertas" }))
    .getAllByRole("heading", { level: 2 })
    .map((h) => h.textContent);
const item = (titulo: string) => screen.getByRole("heading", { name: titulo, level: 2 }).closest("article")!;
const leer = (titulo: string) => screen.getByRole("button", { name: `Marcar como leída: ${titulo}` });
const chip = (nombre: RegExp) => within(screen.getByRole("group", { name: "Filtrar alertas" })).getByRole("button", { name: nombre });
const campana = () => screen.getByRole("link", { name: "Alertas" });
const consultas = () => vi.mocked(getAlertas).mock.calls.map(([c]) => c);

beforeEach(() => {
  localStorage.clear();
  // 12 alertas: 5 sin leer, 6 leídas y 1 revisada.
  servidor = [
    ...[1, 2, 3, 4, 5].map((n) => alerta(n)),
    ...[6, 7, 8, 9, 10, 11].map((n) => alerta(n, "leida")),
    alerta(12, "revisada"),
  ];
  vi.mocked(getAlertas).mockReset().mockImplementation(async (c) => leerServidor(c));
  vi.mocked(getContadorAlertas)
    .mockReset()
    .mockImplementation(async () => ({ pendientes: pendientesEnServidor(), total: servidor.length }));
  vi.mocked(marcarAlertaLeida).mockReset().mockImplementation(async (id) => leerEnServidor(id));
  vi.mocked(marcarTodasLasAlertasLeidas)
    .mockReset()
    .mockImplementation(async () => {
      const cuantas = pendientesEnServidor();
      servidor.forEach((a) => a.pendiente && leerEnServidor(a.id));
      return { leidas: cuantas };
    });
});

afterEach(() => {
  cleanup();
});

describe("Centro de alertas (SE-01, CH-31)", () => {
  it("lista la primera página con su estado, y la campana cuenta las sin leer de toda la organización", async () => {
    await montar();
    expect(titulos()).toEqual(["Aviso 1", "Aviso 2", "Aviso 3", "Aviso 4", "Aviso 5", "Aviso 6", "Aviso 7", "Aviso 8", "Aviso 9", "Aviso 10"]);
    expect(within(item("Aviso 1")).getByText("Sin leer")).toBeInTheDocument();
    expect(within(item("Aviso 1")).getByText("Detalle del aviso 1.")).toBeInTheDocument();
    expect(within(item("Aviso 1")).getByText(/Próximo cobro/)).toBeInTheDocument();
    expect(within(item("Aviso 6")).getByText("Leída")).toBeInTheDocument();
    // Solo las sin leer se pueden marcar.
    expect(within(item("Aviso 6")).queryByRole("button")).not.toBeInTheDocument();

    expect(campana()).toHaveAccessibleDescription("5 alertas sin leer");
    expect(chip(/^Sin leer/)).toHaveTextContent("5");
    expect(screen.getByRole("navigation", { name: "Páginas de alertas" })).toHaveTextContent("Página 1 de 2");
    expect(consultas().at(-1)).toEqual({ lectura: undefined, pagina: 1 });
  });

  it("marcar una como leída cambia la fila, la campana y el chip a la vez", async () => {
    await montar();
    await clic(leer("Aviso 2"));

    expect(marcarAlertaLeida).toHaveBeenCalledTimes(1);
    expect(marcarAlertaLeida).toHaveBeenCalledWith("a2");
    expect(within(item("Aviso 2")).getByText("Leída")).toBeInTheDocument();
    expect(within(item("Aviso 2")).queryByRole("button")).not.toBeInTheDocument();
    expect(campana()).toHaveAccessibleDescription("4 alertas sin leer");
    expect(chip(/^Sin leer/)).toHaveTextContent("4");
    // En «Todas» la fila se queda en su lugar.
    expect(titulos()[1]).toBe("Aviso 2");
  });

  it("la campana baja apenas el servidor confirma la lectura, sin esperar al contador", async () => {
    await montar();
    // El contador tarda: lo que se ve tiene que salir de la lectura confirmada.
    vi.mocked(getContadorAlertas).mockReturnValue(new Promise(() => {}));
    await clic(leer("Aviso 2"));
    expect(campana()).toHaveAccessibleDescription("4 alertas sin leer");
    expect(chip(/^Sin leer/)).toHaveTextContent("4");
  });

  it("dos clics en el mismo instante mandan un solo POST y descuentan una vez", async () => {
    await montar();
    const respuesta = diferida<Alerta>();
    vi.mocked(marcarAlertaLeida).mockReturnValueOnce(respuesta.promesa);
    const boton = leer("Aviso 3");
    await act(async () => {
      fireEvent.click(boton);
      fireEvent.click(boton);
    });
    expect(marcarAlertaLeida).toHaveBeenCalledTimes(1);
    expect(boton).toBeDisabled();

    await act(async () => respuesta.resolver(leerEnServidor("a3")));
    expect(campana()).toHaveAccessibleDescription("4 alertas sin leer");
  });

  it("con «Sin leer», la que se lee sale y la página trae la que corrió a su lugar", async () => {
    // 11 sin leer: la undécima está en la página 2.
    servidor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => alerta(n));
    await montar("/alertas?lectura=pendiente");
    expect(titulos()).toHaveLength(10);
    expect(titulos()).not.toContain("Aviso 11");

    await clic(leer("Aviso 4"));
    expect(titulos()).not.toContain("Aviso 4");
    expect(titulos()).toContain("Aviso 11");
    expect(titulos()).toHaveLength(10);
    expect(new Set(titulos()).size).toBe(10);
    expect(campana()).toHaveAccessibleDescription("10 alertas sin leer");
    // Ya no hay página 2.
    expect(screen.queryByRole("navigation", { name: "Páginas de alertas" })).not.toBeInTheDocument();
  });

  it("con «Sin leer», la leída sale apenas se confirma, aunque la página tarde en volver", async () => {
    await montar("/alertas?lectura=pendiente");
    vi.mocked(getAlertas).mockReturnValue(new Promise(() => {}));
    await clic(leer("Aviso 4"));
    expect(titulos()).toEqual(["Aviso 1", "Aviso 2", "Aviso 3", "Aviso 5"]);
  });

  it("cambiar de filtro pide al servidor, vuelve a la página 1 y no deja filas del filtro anterior", async () => {
    const router = await montar("/alertas?pagina=2");
    expect(titulos()).toEqual(["Aviso 11", "Aviso 12"]);

    await clic(chip(/^Sin leer/));
    expect(router.state.location.search).toBe("?lectura=pendiente");
    expect(consultas().at(-1)).toEqual({ lectura: "pendiente", pagina: 1 });
    // Otro filtro empieza en su página 1: ni siquiera se pide la 2.
    expect(consultas()).not.toContainEqual({ lectura: "pendiente", pagina: 2 });
    expect(titulos()).toEqual(["Aviso 1", "Aviso 2", "Aviso 3", "Aviso 4", "Aviso 5"]);
    expect(chip(/^Sin leer/)).toHaveAttribute("aria-pressed", "true");

    await clic(chip(/^Leídas/));
    expect(router.state.location.search).toBe("?lectura=leida");
    expect(titulos()).toEqual(["Aviso 6", "Aviso 7", "Aviso 8", "Aviso 9", "Aviso 10", "Aviso 11"]);

    await clic(chip(/^Todas/));
    expect(router.state.location.search).toBe("");
    expect(titulos()).toHaveLength(10);
  });

  it("si nacieron alertas mientras tanto, cambiar de filtro pone al día la campana y el chip", async () => {
    await montar();
    expect(campana()).toHaveAccessibleDescription("5 alertas sin leer");
    servidor = [alerta(13), alerta(14), ...servidor];

    await clic(chip(/^Sin leer/));
    expect(titulos()).toHaveLength(7);
    expect(campana()).toHaveAccessibleDescription("7 alertas sin leer");
    expect(chip(/^Sin leer/)).toHaveTextContent("7");
  });

  it("una respuesta del filtro anterior que llega tarde no se mezcla con la del nuevo", async () => {
    const vieja = diferida<Paginado<Alerta>>();
    vi.mocked(getAlertas).mockImplementation((c) => (c?.lectura ? Promise.resolve(leerServidor(c)) : vieja.promesa));
    await montar();
    await clic(chip(/^Sin leer/));
    expect(titulos()).toEqual(["Aviso 1", "Aviso 2", "Aviso 3", "Aviso 4", "Aviso 5"]);

    await act(async () => vieja.resolver(leerServidor({ pagina: 1 })));
    expect(titulos()).toEqual(["Aviso 1", "Aviso 2", "Aviso 3", "Aviso 4", "Aviso 5"]);
  });

  it("mientras carga otro filtro no se ven las filas del anterior", async () => {
    await montar();
    vi.mocked(getAlertas).mockReturnValueOnce(new Promise(() => {}));
    await clic(chip(/^Leídas/));
    expect(lista()).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus alertas…");
  });

  it("Siguiente y Anterior cambian de página en el servidor y en la URL", async () => {
    const router = await montar();
    const paginas = () => screen.getByRole("navigation", { name: "Páginas de alertas" });
    expect(within(paginas()).getByRole("button", { name: "Anterior" })).toBeDisabled();

    await clic(within(paginas()).getByRole("button", { name: "Siguiente" }));
    expect(router.state.location.search).toBe("?pagina=2");
    expect(consultas().at(-1)).toEqual({ lectura: undefined, pagina: 2 });
    expect(titulos()).toEqual(["Aviso 11", "Aviso 12"]);
    expect(within(item("Aviso 12")).getByText("Revisada")).toBeInTheDocument();
    expect(paginas()).toHaveTextContent("Página 2 de 2");
    expect(within(paginas()).getByRole("button", { name: "Siguiente" })).toBeDisabled();

    await clic(within(paginas()).getByRole("button", { name: "Anterior" }));
    expect(router.state.location.search).toBe("");
    expect(titulos()[0]).toBe("Aviso 1");
  });

  it("si se lee la única de la última página, pasa a la anterior sin decir «Estás al día» ni un instante", async () => {
    servidor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => alerta(n));
    const router = await montar("/alertas?lectura=pendiente&pagina=2");
    expect(titulos()).toEqual(["Aviso 11"]);

    // Cualquier nodo que se haya agregado, aunque se quite en el render siguiente.
    const agregados: string[] = [];
    const observador = new MutationObserver((registros) =>
      registros.forEach((r) => r.addedNodes.forEach((n) => agregados.push(n.textContent ?? ""))),
    );
    observador.observe(document.body, { childList: true, subtree: true });
    await clic(leer("Aviso 11"));
    observador.disconnect();

    expect(router.state.location.search).toBe("?lectura=pendiente");
    expect(titulos()).toHaveLength(10);
    expect(agregados.join(" ")).not.toContain("Estás al día");
  });

  it("si se vacía la página 3, pasa a la 2 y no a la primera", async () => {
    servidor = Array.from({ length: 21 }, (_, i) => alerta(i + 1));
    const router = await montar("/alertas?lectura=pendiente&pagina=3");
    expect(titulos()).toEqual(["Aviso 21"]);

    await clic(leer("Aviso 21"));
    expect(router.state.location.search).toBe("?lectura=pendiente&pagina=2");
    expect(titulos()[0]).toBe("Aviso 11");
  });

  it("una página de la URL que ya no existe lleva a la primera", async () => {
    const router = await montar("/alertas?pagina=9");
    expect(router.state.location.search).toBe("");
    expect(titulos()[0]).toBe("Aviso 1");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("un filtro o una página inventados en la URL valen «Todas» y la primera", async () => {
    await montar("/alertas?lectura=nada&pagina=-3");
    expect(consultas().at(-1)).toEqual({ lectura: undefined, pagina: 1 });
    expect(chip(/^Todas/)).toHaveAttribute("aria-pressed", "true");
  });

  it("«Marcar todas como leídas» manda un POST, vacía la campana y cambia las filas", async () => {
    await montar();
    await clic(screen.getByRole("button", { name: "Marcar todas como leídas" }));

    expect(marcarTodasLasAlertasLeidas).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Marcamos 5 alertas como leídas.")).toBeInTheDocument();
    expect(campana()).not.toHaveAttribute("aria-describedby");
    expect(campana()).toHaveTextContent("");
    expect(chip(/^Sin leer/)).toHaveTextContent("0");
    expect(screen.queryByRole("button", { name: /^Marcar como leída/ })).not.toBeInTheDocument();
    expect(within(item("Aviso 1")).getByText("Leída")).toBeInTheDocument();
    // Sin ninguna sin leer, el botón desaparece.
    expect(screen.queryByRole("button", { name: "Marcar todas como leídas" })).not.toBeInTheDocument();
  });

  it("marcar todas cambia las filas apenas se confirma, aunque la página tarde en volver", async () => {
    await montar();
    vi.mocked(getAlertas).mockReturnValue(new Promise(() => {}));
    await clic(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    expect(screen.queryByText("Sin leer", { selector: "article *" })).not.toBeInTheDocument();
    expect(within(item("Aviso 1")).getByText("Leída")).toBeInTheDocument();
  });

  it("con «Sin leer», marcar todas deja «Estás al día» con un camino de vuelta a Todas", async () => {
    const router = await montar("/alertas?lectura=pendiente");
    await clic(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    expect(screen.getByRole("heading", { name: "Estás al día" })).toBeInTheDocument();

    await clic(screen.getByRole("button", { name: "Ver todas" }));
    expect(router.state.location.search).toBe("");
    expect(titulos()).toHaveLength(10);
  });

  it("con «Sin leer» en la página 2, marcar todas vuelve a la primera y dice «Estás al día»", async () => {
    servidor = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => alerta(n));
    const router = await montar("/alertas?lectura=pendiente&pagina=2");
    await clic(screen.getByRole("button", { name: "Marcar todas como leídas" }));
    expect(router.state.location.search).toBe("?lectura=pendiente");
    expect(screen.getByRole("heading", { name: "Estás al día" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("si marcar falla, lo dice y no cambian ni la fila ni la campana", async () => {
    await montar();
    vi.mocked(marcarAlertaLeida).mockRejectedValueOnce(new ErrorDeApi("Error interno.", 500));
    await clic(leer("Aviso 1"));
    expect(screen.getByText("No pudimos marcar la alerta como leída. Intenta de nuevo.")).toBeInTheDocument();
    expect(within(item("Aviso 1")).getByText("Sin leer")).toBeInTheDocument();
    expect(leer("Aviso 1")).toBeEnabled();
    expect(campana()).toHaveAccessibleDescription("5 alertas sin leer");

    vi.mocked(marcarAlertaLeida).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await clic(leer("Aviso 1"));
    expect(screen.getByText(/No pudimos conectar con el servidor/)).toBeInTheDocument();
  });

  it("si la alerta ya no existe, lo dice, la saca y corrige la campana", async () => {
    await montar();
    servidor = servidor.filter((a) => a.id !== "a2");
    await clic(leer("Aviso 2"));
    expect(screen.getByText("Esa alerta ya no existe.")).toBeInTheDocument();
    expect(titulos()).not.toContain("Aviso 2");
    expect(campana()).toHaveAccessibleDescription("4 alertas sin leer");
  });

  it("si la primera carga falla, lo dice con Reintentar y al reintentar se ven", async () => {
    vi.mocked(getAlertas).mockRejectedValue(new TypeError("Failed to fetch"));
    await montar();
    expect(screen.getByRole("alert")).toHaveTextContent(/No pudimos conectar con el servidor/);
    expect(lista()).not.toBeInTheDocument();

    // Mientras reintenta dice «Cargando», no el error de antes.
    const reintento = diferida<Paginado<Alerta>>();
    vi.mocked(getAlertas).mockReturnValueOnce(reintento.promesa);
    await clic(screen.getByRole("button", { name: "Reintentar" }));
    expect(screen.getByRole("status")).toHaveTextContent("Cargando tus alertas…");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => reintento.resolver(leerServidor({ pagina: 1 })));
    expect(titulos()).toHaveLength(10);
  });

  it("si la recarga después de leer falla, la lista se queda y se puede reintentar", async () => {
    await montar();
    vi.mocked(getAlertas).mockRejectedValueOnce(new ErrorDeApi("Error interno.", 500));
    await clic(leer("Aviso 1"));

    expect(titulos()).toHaveLength(10);
    expect(within(item("Aviso 1")).getByText("Leída")).toBeInTheDocument();
    const aviso = screen.getByText("No pudimos actualizar tus alertas: puede que la lista no esté al día. Intenta de nuevo.");
    await clic(within(aviso.parentElement!).getByRole("button", { name: "Reintentar" }));
    expect(screen.queryByText(/puede que la lista no esté al día/)).not.toBeInTheDocument();
  });

  it("sin alertas muestra el estado vacío, sin botón de marcar todas ni paginación", async () => {
    servidor = [];
    await montar();
    expect(screen.getByRole("heading", { name: "No tienes alertas" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ver todas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar todas como leídas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Páginas de alertas" })).not.toBeInTheDocument();
  });

  it("«Configurar avisos» lleva a Ajustes y «Ver suscripción» a su detalle", async () => {
    servidor = [alerta(1, "pendiente", { titulo: "Netflix subió de precio", suscripcion_id: "s-9" })];
    const router = await montar();
    expect(within(item("Netflix subió de precio")).getByRole("link", { name: "Ver suscripción: Netflix subió de precio" })).toHaveAttribute(
      "href",
      "/suscripciones/s-9",
    );
    await clic(screen.getByRole("link", { name: "Configurar avisos" }));
    expect(router.state.location.pathname).toBe("/configuracion");
  });
});
