// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  descartarRecomendacion,
  ErrorDeApi,
  explicarRecomendacion,
  getRecomendaciones,
  type ExplicacionRecomendacion,
  type ListaRecomendaciones,
  type Recomendacion,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RecomendacionesPage } from "./RecomendacionesPage";

// Solo se simula la red; la página, el hook y los componentes son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getRecomendaciones: vi.fn(), descartarRecomendacion: vi.fn(), explicarRecomendacion: vi.fn() };
});
const getRecomendacionesMock = vi.mocked(getRecomendaciones);
const descartarMock = vi.mocked(descartarRecomendacion);
const explicarMock = vi.mocked(explicarRecomendacion);

// La forma real de VI-17 (RecomendacionConsolidacionSerializer).
const NETFLIX: Recomendacion = {
  id: "9b2c1d3e-0000-4000-8000-000000000001",
  suscripcion_id: "s01",
  nombre: "Netflix",
  categoria: "streaming",
  motivo: "Tienes dos planes de streaming con el mismo catálogo.",
  ahorro_estimado: 5000,
  moneda: "CLP",
};
const ICLOUD: Recomendacion = {
  id: "9b2c1d3e-0000-4000-8000-000000000002",
  nombre: "iCloud",
  motivo: "Pagas almacenamiento en dos servicios.",
  ahorro_estimado: 4.5,
  moneda: "USD",
};
const lista = (results: Recomendacion[], extra: Partial<ListaRecomendaciones> = {}): ListaRecomendaciones => ({
  results,
  total: results.length,
  disponible: true,
  motivo_sin_sugerencias: results.length ? null : "Todavía no hay recomendaciones de consolidación generadas.",
  ...extra,
});
const CONFIRMACION = { recomendacion_id: NETFLIX.id, vigente_hasta: "2026-11-27T12:00:00Z", descartado: true as const };

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

async function montar() {
  render(
    <MemoryRouter initialEntries={["/recomendaciones"]}>
      <ToastProvider>
        <AuthProvider>
          <RecomendacionesPage />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

const tarjeta = (nombre: string) => screen.getByRole("heading", { name: nombre, level: 2 }).closest("li")!;
const noMeInteresa = (nombre: string) =>
  act(async () => fireEvent.click(within(tarjeta(nombre)).getByRole("button", { name: `No me interesa: ${nombre}` })));

beforeEach(() => {
  localStorage.clear();
  getRecomendacionesMock.mockReset();
  descartarMock.mockReset();
  explicarMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("Recomendaciones con VI-17", () => {
  it("muestra cada recomendación con su motivo y el ahorro en su moneda", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD]));
    await montar();

    expect(within(tarjeta("Netflix")).getByText(NETFLIX.motivo!)).toBeInTheDocument();
    expect(tarjeta("Netflix")).toHaveTextContent("Ahorro estimado: $5.000");
    expect(tarjeta("iCloud")).toHaveTextContent("Ahorro estimado: US$4,50");
    // Solo se ofrece ir al detalle si la recomendación dice de qué suscripción es.
    expect(within(tarjeta("Netflix")).getByRole("link", { name: "Ver suscripción" })).toHaveAttribute("href", "/suscripciones/s01");
    expect(within(tarjeta("iCloud")).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("Estado vacío (CH-26)", () => {
  it("una lista vacía se muestra como ausencia de sugerencias, con el motivo del backend y sin ahorro", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([]));
    await montar();

    expect(screen.getByRole("heading", { name: "No tienes recomendaciones por ahora" })).toBeInTheDocument();
    expect(screen.getByText("Todavía no hay recomendaciones de consolidación generadas.")).toBeInTheDocument();
    expect(screen.queryByText(/Ahorro/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("sin umbral configurado dice que todavía no están disponibles, no que no hay ninguna", async () => {
    getRecomendacionesMock.mockResolvedValue(
      lista([], {
        disponible: false,
        motivo_sin_sugerencias:
          "No hay umbral de ahorro configurado para ninguna moneda. Sin configuración válida no se emiten recomendaciones.",
      }),
    );
    await montar();

    expect(screen.getByRole("heading", { name: "Las recomendaciones todavía no están disponibles" })).toBeInTheDocument();
    expect(screen.queryByText("No tienes recomendaciones por ahora")).not.toBeInTheDocument();
  });

  it.each([
    ["sin red", new TypeError("Failed to fetch"), "No pudimos conectar con el servidor."],
    ["un error del servidor", new ErrorDeApi("Falta el contexto de organización", 403), "Falta el contexto de organización"],
  ])("con %s avisa el error y permite reintentar; no se confunde con vacío", async (_, error, mensaje) => {
    getRecomendacionesMock.mockRejectedValueOnce(error).mockResolvedValueOnce(lista([NETFLIX]));
    await montar();

    expect(screen.getByRole("alert")).toHaveTextContent(mensaje);
    expect(screen.queryByText("No tienes recomendaciones por ahora")).not.toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Reintentar" })));
    expect(getRecomendacionesMock).toHaveBeenCalledTimes(2);
    expect(tarjeta("Netflix")).toBeInTheDocument();
  });
});

describe("No me interesa (CH-32)", () => {
  it("retira la tarjeta solo cuando el servidor confirma, avisa y deja el foco en la lista", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD]));
    const respuesta = diferida<typeof CONFIRMACION>();
    descartarMock.mockReturnValue(respuesta.promesa);
    await montar();

    await noMeInteresa("Netflix");
    expect(descartarMock).toHaveBeenCalledWith(NETFLIX.id);
    // Mientras viaja sigue ahí, y el botón no deja mandar otro.
    const boton = within(tarjeta("Netflix")).getByRole("button", { name: "No me interesa: Netflix" });
    expect(boton).toBeDisabled();
    fireEvent.click(boton);
    expect(descartarMock).toHaveBeenCalledTimes(1);

    await act(async () => respuesta.resolver(CONFIRMACION));
    expect(screen.queryByRole("heading", { name: "Netflix" })).not.toBeInTheDocument();
    expect(tarjeta("iCloud")).toBeInTheDocument();
    expect(screen.getByText("Listo, dejamos de mostrarte esa recomendación.")).toBeInTheDocument();
    expect(screen.getByLabelText("Recomendaciones")).toHaveFocus();
  });

  it("si falla, la recomendación se queda con el aviso y se puede reintentar", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD]));
    descartarMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(CONFIRMACION);
    await montar();

    await noMeInteresa("Netflix");
    expect(within(tarjeta("Netflix")).getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
    expect(within(tarjeta("iCloud")).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/dejamos de mostrarte/)).not.toBeInTheDocument();

    await noMeInteresa("Netflix");
    expect(descartarMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: "Netflix" })).not.toBeInTheDocument();
  });

  it("al descartar la última queda el estado vacío, sin ahorro", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    descartarMock.mockResolvedValue(CONFIRMACION);
    await montar();

    await noMeInteresa("Netflix");
    expect(screen.getByRole("heading", { name: "No tienes recomendaciones por ahora" })).toBeInTheDocument();
    expect(screen.queryByText(/Ahorro/)).not.toBeInTheDocument();
  });
});

// La forma real de MX-25 (ExplicacionSerializer).
const EXPLICACION_NETFLIX: ExplicacionRecomendacion = {
  id: NETFLIX.id,
  suscripcion_id: "s01",
  explicacion:
    "Tienes dos planes de streaming con el mismo catálogo. Ahorro estimado: 5000.00 CLP. Base de cálculo: el plan más barato. Es una estimación, no un ahorro confirmado.",
  fuente: "reglas",
  estado: "disponible",
  motivo: NETFLIX.motivo ?? null,
  ahorro_estimado: 5000,
  moneda: "CLP",
  base_calculo: "el plan más barato",
  evidencia: null,
  uso: "no_evaluado",
  advertencia_uso: "La consolidación se basa en solapamiento; no afirma bajo uso ni calcula un puntaje de actividad.",
};
const SIN_DATOS_SUFICIENTES: ExplicacionRecomendacion = {
  ...EXPLICACION_NETFLIX,
  explicacion:
    "Esta recomendación no tiene motivo, base de cálculo o evidencia suficientes para justificar una estimación de ahorro. Revisa la información de origen.",
  estado: "datos_insuficientes",
  motivo: null,
  ahorro_estimado: null,
  base_calculo: null,
};
const MENSAJE_SIN_RED = "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.";

/** El botón que abre o cierra la explicación de una tarjeta, se llame como se llame en ese momento. */
const botonExplicacion = (nombre: string) =>
  within(tarjeta(nombre)).getByRole("button", { name: new RegExp(`explicación: ${nombre}$`) });
const alternarExplicacion = (nombre: string) => act(async () => fireEvent.click(botonExplicacion(nombre)));
const panelDe = (nombre: string) => document.getElementById(botonExplicacion(nombre).getAttribute("aria-controls")!)!;

describe("Motivo, ahorro y explicación (CH-22)", () => {
  it("el ahorro es el de la API con su moneda; un dato faltante no se disfraza de cero ni de pesos", async () => {
    const sinMonto: Recomendacion = { id: "r-sin-monto", nombre: "Sin monto", motivo: "Sin cifra." };
    const enCero: Recomendacion = { id: "r-en-cero", nombre: "En cero", ahorro_estimado: 0, moneda: "CLP" };
    const sinMoneda: Recomendacion = { id: "r-sin-moneda", nombre: "Sin moneda", ahorro_estimado: 3000 };
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD, sinMonto, enCero, sinMoneda]));
    await montar();

    expect(within(tarjeta("Netflix")).getByText("Ahorro estimado: $5.000")).toBeInTheDocument();
    expect(within(tarjeta("iCloud")).getByText("Ahorro estimado: US$4,50")).toBeInTheDocument();
    expect(within(tarjeta("En cero")).getByText("Ahorro estimado: $0")).toBeInTheDocument();
    for (const nombre of ["Sin monto", "Sin moneda"]) {
      expect(within(tarjeta(nombre)).getByText("Ahorro estimado no disponible")).toBeInTheDocument();
      expect(tarjeta(nombre)).not.toHaveTextContent("$");
    }
  });

  it("pide la explicación solo al abrirla y la muestra tal como la arma el backend", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD]));
    explicarMock.mockResolvedValue(EXPLICACION_NETFLIX);
    await montar();
    expect(explicarMock).not.toHaveBeenCalled();
    expect(botonExplicacion("Netflix")).toHaveAttribute("aria-expanded", "false");

    await alternarExplicacion("Netflix");
    expect(explicarMock).toHaveBeenCalledTimes(1);
    expect(explicarMock).toHaveBeenCalledWith(NETFLIX.id);
    expect(botonExplicacion("Netflix")).toHaveAttribute("aria-expanded", "true");
    expect(botonExplicacion("Netflix")).toHaveAccessibleName("Ocultar explicación: Netflix");
    expect(within(panelDe("Netflix")).getByText(EXPLICACION_NETFLIX.explicacion)).toBeInTheDocument();
    expect(within(panelDe("Netflix")).getByText(EXPLICACION_NETFLIX.advertencia_uso)).toBeInTheDocument();
    // La otra tarjeta sigue cerrada.
    expect(botonExplicacion("iCloud")).toHaveAttribute("aria-expanded", "false");

    // Ocultar y volver a abrir muestra la misma, sin pedirla otra vez.
    await alternarExplicacion("Netflix");
    expect(screen.queryByText(EXPLICACION_NETFLIX.explicacion)).not.toBeInTheDocument();
    await alternarExplicacion("Netflix");
    expect(screen.getByText(EXPLICACION_NETFLIX.explicacion)).toBeInTheDocument();
    expect(explicarMock).toHaveBeenCalledTimes(1);
  });

  it("mientras llega dice que está cargando, sin texto de explicación", async () => {
    const respuesta = diferida<ExplicacionRecomendacion>();
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockReturnValue(respuesta.promesa);
    await montar();

    await alternarExplicacion("Netflix");
    expect(within(panelDe("Netflix")).getByRole("status")).toHaveTextContent("Cargando explicación…");

    await act(async () => respuesta.resolver(EXPLICACION_NETFLIX));
    expect(within(panelDe("Netflix")).queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByText(EXPLICACION_NETFLIX.explicacion)).toBeInTheDocument();
  });

  it("sin datos suficientes muestra solo el texto del backend, sin advertencia ni cifras propias", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockResolvedValue(SIN_DATOS_SUFICIENTES);
    await montar();

    await alternarExplicacion("Netflix");
    expect(panelDe("Netflix").textContent).toBe(SIN_DATOS_SUFICIENTES.explicacion);
  });

  it("una explicación sin texto no se rellena con otra: se dice que no hay", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockResolvedValue({ ...EXPLICACION_NETFLIX, explicacion: "   " });
    await montar();

    await alternarExplicacion("Netflix");
    expect(panelDe("Netflix").textContent).toBe("No hay una explicación disponible para esta recomendación.");
  });

  it("si falla por la red deja el error en el panel y Reintentar la vuelve a pedir", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(EXPLICACION_NETFLIX);
    await montar();

    await alternarExplicacion("Netflix");
    expect(within(panelDe("Netflix")).getByRole("alert")).toHaveTextContent(MENSAJE_SIN_RED);
    expect(screen.queryByText(EXPLICACION_NETFLIX.explicacion)).not.toBeInTheDocument();

    await act(async () => fireEvent.click(within(panelDe("Netflix")).getByRole("button", { name: "Reintentar" })));
    expect(screen.getByText(EXPLICACION_NETFLIX.explicacion)).toBeInTheDocument();
    expect(within(tarjeta("Netflix")).queryByRole("alert")).not.toBeInTheDocument();
    expect(explicarMock).toHaveBeenCalledTimes(2);
  });

  it("tras un error, cerrar y volver a abrir la pide de nuevo", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValueOnce(EXPLICACION_NETFLIX);
    await montar();

    await alternarExplicacion("Netflix");
    await alternarExplicacion("Netflix");
    await alternarExplicacion("Netflix");
    expect(screen.getByText(EXPLICACION_NETFLIX.explicacion)).toBeInTheDocument();
    expect(explicarMock).toHaveBeenCalledTimes(2);
  });

  it("un 404 dice que ya no está disponible y la tarjeta se queda como estaba", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX]));
    explicarMock.mockRejectedValue(new ErrorDeApi("Recomendación no encontrada.", 404));
    await montar();

    await alternarExplicacion("Netflix");
    expect(within(panelDe("Netflix")).getByRole("alert")).toHaveTextContent(
      "Esta recomendación ya no está disponible. Vuelve a cargar la lista.",
    );
    expect(within(tarjeta("Netflix")).getByText(NETFLIX.motivo!)).toBeInTheDocument();
    expect(within(tarjeta("Netflix")).getByText("Ahorro estimado: $5.000")).toBeInTheDocument();
  });

  it("al descartar una recomendación con la explicación abierta se retira completa", async () => {
    getRecomendacionesMock.mockResolvedValue(lista([NETFLIX, ICLOUD]));
    explicarMock.mockResolvedValue(EXPLICACION_NETFLIX);
    descartarMock.mockResolvedValue(CONFIRMACION);
    await montar();

    await alternarExplicacion("Netflix");
    await noMeInteresa("Netflix");
    expect(screen.queryByRole("heading", { name: "Netflix", level: 2 })).not.toBeInTheDocument();
    expect(screen.queryByText(EXPLICACION_NETFLIX.explicacion)).not.toBeInTheDocument();
  });
});
