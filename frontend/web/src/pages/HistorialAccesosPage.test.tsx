// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaginaAccesos } from "@ojoalgasto/shared";
import { HistorialAccesosPage } from "./HistorialAccesosPage";

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

const PAGINA_1: PaginaAccesos = {
  accesos: [
    { iniciadaEn: "2026-11-20T15:30:00Z", metodo: "google" },
    { iniciadaEn: "2026-11-18T09:10:00Z", metodo: "local" },
  ],
  siguienteOffset: null,
};

function diferida<T>() {
  let resolver!: (v: T) => void;
  let rechazar!: (e: unknown) => void;
  const promesa = new Promise<T>((res, rej) => {
    resolver = res;
    rechazar = rej;
  });
  return { promesa, resolver, rechazar };
}

function montar(cargarPagina: (offset: number) => Promise<PaginaAccesos>) {
  render(
    <MemoryRouter>
      <HistorialAccesosPage cargarPagina={cargarPagina} />
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
  it("muestra los accesos con su método y pide la primera página desde el offset 0", async () => {
    const cargar = vi.fn().mockResolvedValue(PAGINA_1);
    montar(cargar);
    expect(await screen.findByText("Con Google")).toBeInTheDocument();
    expect(screen.getByText("Con contraseña")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(cargar).toHaveBeenCalledWith(0);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("sin accesos lo dice", async () => {
    montar(vi.fn().mockResolvedValue({ accesos: [], siguienteOffset: null }));
    expect(await screen.findByText("Todavía no hay accesos registrados.")).toBeInTheDocument();
  });

  it("si falla muestra el error y Reintentar vuelve a pedir", async () => {
    const cargar = vi.fn().mockRejectedValueOnce(new Error("caído")).mockResolvedValueOnce(PAGINA_1);
    montar(cargar);
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar tu historial de accesos.");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Con Google")).toBeInTheDocument();
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  it("Cargar más pide desde siguiente_offset y agrega los accesos sin repetir los anteriores", async () => {
    const cargar = vi
      .fn()
      .mockResolvedValueOnce({ accesos: PAGINA_1.accesos, siguienteOffset: 2 })
      .mockResolvedValueOnce({
        accesos: [{ iniciadaEn: "2026-11-10T08:00:00Z", metodo: "local" }],
        siguienteOffset: null,
      });
    montar(cargar);
    await screen.findByText("Con Google");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(cargar).toHaveBeenLastCalledWith(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
  });

  it("si falla Cargar más conserva lo que ya había, lo avisa y permite reintentar", async () => {
    const cargar = vi
      .fn()
      .mockResolvedValueOnce({ accesos: PAGINA_1.accesos, siguienteOffset: 2 })
      .mockRejectedValueOnce(new Error("caído"));
    montar(cargar);
    await screen.findByText("Con Google");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos cargar más accesos");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cargar más" })).toBeInTheDocument();
  });

  it("un doble clic en Cargar más pide una sola página", async () => {
    const espera = diferida<PaginaAccesos>();
    const cargar = vi
      .fn()
      .mockResolvedValueOnce({ accesos: PAGINA_1.accesos, siguienteOffset: 2 })
      .mockReturnValueOnce(espera.promesa);
    montar(cargar);
    await screen.findByText("Con Google");
    const boton = screen.getByRole("button", { name: "Cargar más" });
    fireEvent.click(boton);
    fireEvent.click(boton);
    expect(cargar).toHaveBeenCalledTimes(2);
    await act(async () => {
      espera.resolver({ accesos: [], siguienteOffset: null });
    });
  });

  it("no acumula más de 100 accesos aunque el backend ofrezca más y avisa", async () => {
    const cien = Array.from({ length: 100 }, (_, i) => ({
      iniciadaEn: new Date(Date.UTC(2026, 10, 20, 0, 0, i)).toISOString(),
      metodo: "local" as const,
    }));
    montar(vi.fn().mockResolvedValue({ accesos: cien, siguienteOffset: 100 }));
    await screen.findAllByText("Con contraseña");
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    expect(screen.queryByRole("button", { name: "Cargar más" })).toBeNull();
    expect(screen.getByText(/Mostrando los 100 accesos más recientes/)).toBeInTheDocument();
  });

  it("una respuesta que llega con otra sesión no se pinta", async () => {
    const espera = diferida<PaginaAccesos>();
    montar(() => espera.promesa);
    sesionActual.valor = 2;
    await act(async () => {
      espera.resolver(PAGINA_1);
    });
    expect(screen.queryByText("Con Google")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando accesos");
  });

  it("una página de 'Cargar más' que llega con otra sesión no se agrega", async () => {
    const espera = diferida<PaginaAccesos>();
    const cargar = vi
      .fn()
      .mockResolvedValueOnce({ accesos: PAGINA_1.accesos, siguienteOffset: 2 })
      .mockReturnValueOnce(espera.promesa);
    montar(cargar);
    await screen.findByText("Con Google");
    fireEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    sesionActual.valor = 2;
    await act(async () => {
      espera.resolver({ accesos: [{ iniciadaEn: "2026-11-01T00:00:00Z", metodo: "local" }], siguienteOffset: null });
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});
