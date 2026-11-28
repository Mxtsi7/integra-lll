// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getCobrosDelMes, type CobroCalendario } from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { AgendaPage } from "./AgendaPage";
import { CalendarioPage } from "./CalendarioPage";

// Mock del cliente API de shared (VI-07) para simular la respuesta del Gateway
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getCobrosDelMes: vi.fn() };
});
const getCobrosMock = vi.mocked(getCobrosDelMes);

beforeAll(() => {
  vi.stubEnv("TZ", "America/Santiago");
});
afterAll(() => {
  vi.unstubAllEnvs();
});

function cobro(
  id: string,
  fecha: string,
  servicio: string,
  importe: number,
  extra: Partial<CobroCalendario> = {}
): CobroCalendario {
  return {
    id,
    suscripcion_id: `sus-${id}`,
    fecha,
    servicio,
    importe,
    moneda: "CLP",
    tipo: "proyectado",
    ...extra,
  };
}

const EVENTOS_OCTUBRE: CobroCalendario[] = [
  cobro("c1", "2026-10-01", "iCloud", 990, { tipo: "confirmado" }),
  cobro("c2", "2026-10-24", "Netflix", 9990),
  cobro("c3", "2026-10-24", "Spotify", 5990),
  cobro("c4", "2026-10-24", "ChatGPT", 20, { moneda: "USD" }),
  cobro("c5", "2026-10-27", "Gimnasio", 25000, { tipo: "confirmado" }),
];

const EVENTOS_NOVIEMBRE: CobroCalendario[] = [
  cobro("c6", "2026-11-05", "Netflix", 9990),
  cobro("c7", "2026-11-15", "Disney+", 7990, { tipo: "confirmado" }),
];

const COBROS_POR_MES: Record<string, CobroCalendario[]> = {
  "2026-10": EVENTOS_OCTUBRE,
  "2026-11": EVENTOS_NOVIEMBRE,
};

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{`${pathname}${search}`}</div>;
}

async function montarEnDesktop(ruta = "/calendario") {
  render(
    <StrictMode>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[ruta]}>
            <Ubicacion />
            <Routes>
              <Route path="/calendario" element={<CalendarioPage />} />
              <Route path="/calendario/agenda" element={<AgendaPage />} />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </StrictMode>
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const ubicacion = () => screen.getByTestId("ubicacion").textContent ?? "";
const cuadricula = (mes = "octubre de 2026") => screen.getByRole("grid", { name: mes });
const dia = (nombre: string | RegExp, mes?: string) => within(cuadricula(mes)).getByRole("button", { name: nombre });
const detalle = () => screen.getByRole("region", { name: /de 20\d\d$/ });

describe("SE-04: Integración del calendario en el cliente Windows Desktop", () => {
  beforeEach(() => {
    // Congelamos fecha de prueba en octubre 2026 (mes 9 en 0-index)
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0));

    // Simula el bridge expuesto por Electron preload.cjs en window.ojoDesktop
    Object.defineProperty(window, "ojoDesktop", {
      value: { apiUrl: "http://127.0.0.1:8015/api" },
      writable: true,
      configurable: true,
    });

    getCobrosMock.mockReset();
    getCobrosMock.mockImplementation((mes: string) => {
      const datos = COBROS_POR_MES[mes] ?? [];
      return Promise.resolve(datos);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete (window as unknown as { ojoDesktop?: unknown }).ojoDesktop;
  });

  it("Windows muestra los mismos eventos que web desde la API configurada", async () => {
    expect(window.ojoDesktop?.apiUrl).toBe("http://127.0.0.1:8015/api");
    await montarEnDesktop("/calendario?mes=2026-10");

    // El hook useCobrosDelMes solicita a getCobrosDelMes el mes cargado
    expect(getCobrosMock).toHaveBeenCalledWith("2026-10");

    // Verifica que se muestran los cobros del mes en la cuadrícula
    expect(screen.getByText("iCloud")).toBeInTheDocument();
    expect(screen.getByText("Gimnasio")).toBeInTheDocument();

    // En el día 24 caben dos cobros en la casilla y un resumen "+1 más"
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("Spotify")).toBeInTheDocument();
    expect(screen.getByText("+1 más")).toBeInTheDocument();
  });

  it("Mes, hoy y detalle del día funcionan correctamente en el entorno desktop", async () => {
    await montarEnDesktop("/calendario?mes=2026-10");

    // 1. Detalle del día: hacer clic en el día 24 muestra sus cobros y totales por moneda
    fireEvent.click(dia(/^sábado, 24 de octubre/));

    expect(detalle()).toHaveAccessibleName("Sábado, 24 de octubre de 2026");
    expect(detalle()).toHaveTextContent("3 cobros");
    expect(within(detalle()).getByText(/^Total del día:/).closest("p")).toHaveTextContent(
      "Total del día: $15.980 y US$20,00"
    );

    // 2. Navegación entre meses: botón "Mes siguiente" pasa a noviembre
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /mes siguiente/i }));
    });

    expect(ubicacion()).toBe("/calendario?mes=2026-11");
    expect(getCobrosMock).toHaveBeenCalledWith("2026-11");
    expect(screen.getByText("Disney+")).toBeInTheDocument();

    // 3. Botón "Hoy": regresa al mes actual (2026-10 según fecha congelada)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^hoy$/i }));
    });
    expect(ubicacion()).toBe("/calendario?mes=2026-10");
  });

  it("El cambio entre cuadrícula y vista de Agenda funciona en desktop", async () => {
    await montarEnDesktop("/calendario?mes=2026-10");

    // Cambiar a la vista Agenda conserva el mes en la URL
    await act(async () => {
      fireEvent.click(screen.getByRole("link", { name: /^agenda$/i }));
    });

    expect(ubicacion()).toBe("/calendario/agenda?mes=2026-10");
    // La agenda muestra los eventos agrupados
    expect(screen.getByRole("heading", { name: /Calendario/i })).toBeInTheDocument();
    expect(screen.getByText("Tus cobros confirmados y los que vienen, en una lista.")).toBeInTheDocument();
    expect(screen.getByText("iCloud")).toBeInTheDocument();
  });

  it("Se adapta adecuadamente al tamaño de ventana desktop (1280x800 y mín. 900x650)", async () => {
    // Simula redimensionamiento a tamaño de ventana desktop normal (1280px)
    window.innerWidth = 1280;
    window.innerHeight = 800;
    await montarEnDesktop("/calendario?mes=2026-10");

    expect(cuadricula("octubre de 2026")).toBeInTheDocument();

    // Simula redimensionamiento a tamaño mínimo de ventana desktop (900px)
    window.innerWidth = 900;
    window.innerHeight = 650;
    fireEvent(window, new Event("resize"));

    expect(cuadricula("octubre de 2026")).toBeInTheDocument();
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });
});
