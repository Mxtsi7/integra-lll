// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  descartarRecomendacion,
  ErrorDeApi,
  getRecomendaciones,
  type ListaRecomendaciones,
  type Recomendacion,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RecomendacionesPage } from "./RecomendacionesPage";

// Solo se simula la red; la página, el hook y los componentes son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getRecomendaciones: vi.fn(), descartarRecomendacion: vi.fn() };
});
const getRecomendacionesMock = vi.mocked(getRecomendaciones);
const descartarMock = vi.mocked(descartarRecomendacion);

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
