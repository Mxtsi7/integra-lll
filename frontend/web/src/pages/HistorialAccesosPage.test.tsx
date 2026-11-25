// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HistorialAccesosPage, type AccesoRegistrado } from "./HistorialAccesosPage";

// Se simulan el layout (pide sus propios datos) y la sesión; la página es la real.
// capturarSesion debe ser la MISMA función en cada render, como en AuthContext (useCallback);
// si cambiara, el efecto de la página volvería a cargar sin parar.
const { sesionActual, capturarSesion } = vi.hoisted(() => {
  const sesionActual = { valor: 1 };
  return { sesionActual, capturarSesion: () => sesionActual.valor };
});
vi.mock("../components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ capturarSesion }),
}));

const ACCESOS: AccesoRegistrado[] = [
  { id: "1", fecha: "2026-11-20T15:30:00Z", dispositivo: "Chrome en Windows", ubicacion: "Santiago", actual: true },
  { id: "2", fecha: "2026-11-18T09:10:00Z", dispositivo: "App móvil Android" },
];

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function montar(cargarAccesos?: () => Promise<AccesoRegistrado[]>) {
  render(
    <MemoryRouter>
      <HistorialAccesosPage cargarAccesos={cargarAccesos} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sesionActual.valor = 1;
});

afterEach(() => {
  cleanup();
});

describe("Historial de accesos (S3-AN-06)", () => {
  it("sin endpoint dice que no está disponible y no muestra accesos inventados", () => {
    montar();
    expect(screen.getByText(/todavía no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("link", { name: "Volver a Ajustes" })).toHaveAttribute("href", "/configuracion");
  });

  it("muestra los accesos que entrega el cargador y marca la sesión actual", async () => {
    montar(vi.fn().mockResolvedValue(ACCESOS));
    expect(await screen.findByText("Chrome en Windows")).toBeInTheDocument();
    expect(screen.getByText(/Esta sesión/)).toBeInTheDocument();
    expect(screen.getByText("App móvil Android")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("sin accesos lo dice", async () => {
    montar(vi.fn().mockResolvedValue([]));
    expect(await screen.findByText("Todavía no hay accesos registrados.")).toBeInTheDocument();
  });

  it("si falla muestra el error y Reintentar vuelve a pedir", async () => {
    const cargar = vi.fn().mockRejectedValueOnce(new Error("caído")).mockResolvedValueOnce(ACCESOS);
    montar(cargar);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu historial de accesos.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Chrome en Windows")).toBeInTheDocument();
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it("no pinta más de 50 accesos y avisa", async () => {
    const muchos = Array.from({ length: 60 }, (_, i) => ({
      id: String(i),
      fecha: "2026-11-20T15:30:00Z",
      dispositivo: `Equipo ${i}`,
    }));
    montar(vi.fn().mockResolvedValue(muchos));
    await screen.findByText("Equipo 0");
    expect(screen.getAllByRole("listitem")).toHaveLength(50);
    expect(screen.getByText(/Mostrando los 50 accesos más recientes/)).toBeInTheDocument();
  });

  it("una respuesta que llega con otra sesión no se pinta", async () => {
    const espera = diferida<AccesoRegistrado[]>();
    montar(() => espera.promesa);
    sesionActual.valor = 2;
    await act(async () => {
      espera.resolver(ACCESOS);
    });
    expect(screen.queryByText("Chrome en Windows")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando accesos");
  });
});
