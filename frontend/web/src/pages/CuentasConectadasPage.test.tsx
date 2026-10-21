// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorDeApi, type CuentaConectada } from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { CuentasConectadasPage, type CuentasConectadasPageProps } from "./CuentasConectadasPage";

// Forma de CuentaConectadaSerializer (services/connectors). Datos solo de
// prueba: la página nunca los inventa, los recibe por `cargarCuentas`.
function cuenta(extra: Partial<CuentaConectada>): CuentaConectada {
  return {
    id: "c1",
    proveedor: "gmail",
    proveedor_legible: "Gmail",
    cuenta_externa: "ana@gmail.com",
    estado: "conectada",
    estado_legible: "Conectada",
    detalle_del_estado: "",
    necesita_reautorizacion: false,
    token_expira_en: null,
    ultima_sincronizacion: "2026-10-15T12:00:00Z",
    creado_en: "2026-10-01T12:00:00Z",
    actualizado_en: "2026-10-15T12:00:00Z",
    ...extra,
  };
}

async function montar(props: CuentasConectadasPageProps = {}) {
  render(
    <StrictMode>
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <CuentasConectadasPage {...props} />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  await act(async () => {});
}

const seccionCuentas = () => screen.getByRole("heading", { name: "Tus cuentas" }).closest("section")!;

afterEach(() => {
  cleanup();
});

describe("Cuentas conectadas (CH-23)", () => {
  it("sin el listado de AN-17 dice que no está disponible, sin inventar cuentas ni decir que no hay", async () => {
    await montar();

    expect(screen.getByRole("heading", { name: "Cuentas conectadas" })).toBeInTheDocument();
    expect(within(seccionCuentas()).getByText(/todavía no está disponible/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText("Todavía no conectas ninguna cuenta")).not.toBeInTheDocument();
    expect(screen.getByText("La conexión con Gmail y Outlook todavía no está disponible.")).toBeInTheDocument();
  });

  it("el bloque para conectar de AN-15 va en su sección", async () => {
    await montar({ accionConectar: <button type="button">Conectar Gmail</button> });

    expect(screen.getByRole("button", { name: "Conectar Gmail" })).toBeInTheDocument();
    expect(screen.queryByText("La conexión con Gmail y Outlook todavía no está disponible.")).not.toBeInTheDocument();
  });

  it("mientras carga muestra el indicador", async () => {
    await montar({ cargarCuentas: () => new Promise(() => {}) });

    expect(screen.getByRole("status", { name: "Cargando tus cuentas conectadas" })).toBeInTheDocument();
  });

  it("sin cuentas muestra el estado vacío", async () => {
    await montar({ cargarCuentas: async () => [] });

    expect(screen.getByRole("heading", { name: "Todavía no conectas ninguna cuenta" })).toBeInTheDocument();
  });

  it("muestra cada estado con el texto que manda el backend", async () => {
    const cuentas = [
      cuenta({ id: "1" }),
      cuenta({
        id: "2",
        proveedor: "outlook",
        proveedor_legible: "Outlook",
        cuenta_externa: "ana@outlook.com",
        estado: "requiere_reautorizacion",
        estado_legible: "Requiere reautorización",
        detalle_del_estado: "El permiso venció.",
        necesita_reautorizacion: true,
      }),
      cuenta({
        id: "3",
        cuenta_externa: "otra@gmail.com",
        estado: "error",
        estado_legible: "Con error",
        detalle_del_estado: "Gmail no respondió.",
        necesita_reautorizacion: true,
        ultima_sincronizacion: null,
      }),
      cuenta({
        id: "4",
        proveedor: "csv",
        proveedor_legible: "Carga de archivo CSV",
        cuenta_externa: "cartola-banco.csv",
        estado: "desconectada",
        estado_legible: "Desconectada",
      }),
    ];
    await montar({ cargarCuentas: async () => cuentas });

    const filas = within(screen.getByRole("list", { name: "Tus cuentas conectadas" })).getAllByRole("listitem");
    expect(filas).toHaveLength(4);

    expect(filas[0]).toHaveTextContent("Gmail");
    expect(filas[0]).toHaveTextContent("ana@gmail.com");
    expect(filas[0]).toHaveTextContent("Conectada");
    expect(filas[0]).toHaveTextContent(/Última revisión: 15 oct 2026/);
    expect(filas[0]).not.toHaveTextContent("Vuelve a autorizar");

    expect(filas[1]).toHaveTextContent("Requiere reautorización");
    expect(filas[1]).toHaveTextContent("El permiso venció.");
    expect(filas[1]).toHaveTextContent("Vuelve a autorizar esta cuenta");

    expect(filas[2]).toHaveTextContent("Con error");
    expect(filas[2]).toHaveTextContent("Gmail no respondió.");
    expect(filas[2]).toHaveTextContent("Todavía no se revisa");

    expect(filas[3]).toHaveTextContent("Carga de archivo CSV");
    expect(filas[3]).toHaveTextContent("Desconectada");
  });

  it("si falla, avisa y Reintentar vuelve a pedir el listado", async () => {
    // Falla hasta que se pulsa Reintentar (StrictMode pide dos veces al montar).
    let falla = true;
    const cargarCuentas = vi.fn(async (): Promise<CuentaConectada[]> => {
      if (falla) throw new ErrorDeApi("Error interno", 500);
      return [cuenta({})];
    });
    await montar({ cargarCuentas });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus cuentas conectadas.");
    const llamadasAlMontar = cargarCuentas.mock.calls.length;
    falla = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    });

    expect(cargarCuentas.mock.calls.length).toBe(llamadasAlMontar + 1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tus cuentas conectadas" })).toHaveTextContent("ana@gmail.com");
  });

  it("sin conexión lo dice distinto de un error del servidor", async () => {
    await montar({ cargarCuentas: () => Promise.reject(new TypeError("Failed to fetch")) });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
  });
});
