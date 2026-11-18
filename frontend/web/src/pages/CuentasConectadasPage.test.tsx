// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorDeApi, type CuentaConectada } from "@ojoalgasto/shared";
import { ToastProvider } from "../context/ToastContext";
import { CuentasConectadasPage, type CuentasConectadasPageProps } from "./CuentasConectadasPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "../context/AuthContext";
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

const envolver = (pagina: ReactElement) => (
  <StrictMode>
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>{pagina}</AuthProvider>
      </ToastProvider>
    </MemoryRouter>
  </StrictMode>
);

async function montar(props: CuentasConectadasPageProps = {}) {
  const resultado = render(envolver(<CuentasConectadasPage {...props} />));
  await act(async () => {});
  return resultado;
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

  it("lleva a las importaciones, donde se ve cómo va cada una (CH-27)", async () => {
    await montar();
    expect(within(seccionCuentas()).getByRole("link", { name: "Ver importaciones" })).toHaveAttribute("href", "/importaciones");
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

  it("una respuesta vieja que llega tarde no pisa a la nueva", async () => {
    let resolverVieja!: (c: CuentaConectada[]) => void;
    const vieja = () => new Promise<CuentaConectada[]>((r) => (resolverVieja = r));
    const nueva = async () => [cuenta({ cuenta_externa: "nueva@gmail.com" })];

    const { rerender } = await montar({ cargarCuentas: vieja });
    rerender(envolver(<CuentasConectadasPage cargarCuentas={nueva} />));
    await act(async () => {});
    await act(async () => resolverVieja([cuenta({ cuenta_externa: "vieja@gmail.com" })]));

    const lista = screen.getByRole("list", { name: "Tus cuentas conectadas" });
    expect(lista).toHaveTextContent("nueva@gmail.com");
    expect(lista).not.toHaveTextContent("vieja@gmail.com");
  });

  it("si llega el envoltorio paginado de GET /api/conectores/ sin desenvolver, es un error y no 'sin cuentas'", async () => {
    // Lo que devuelve FE-02 (PR #82): { count, next, previous, results }.
    const envoltorio = { count: 1, next: null, previous: null, results: [cuenta({})] };
    await montar({ cargarCuentas: async () => envoltorio as unknown as CuentaConectada[] });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus cuentas conectadas.");
    expect(screen.queryByText("Todavía no conectas ninguna cuenta")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("sin conexión lo dice distinto de un error del servidor", async () => {
    await montar({ cargarCuentas: () => Promise.reject(new TypeError("Failed to fetch")) });

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos conectar con el servidor.");
  });
});
it("desconecta con confirmación ejecutando DELETE una sola vez y actualizando el estado", async () => {
    const inicial = cuenta({ id: "c1", estado: "conectada", estado_legible: "Conectada" });
    const revocada = cuenta({ id: "c1", estado: "desconectada", estado_legible: "Desconectada" });
    const onDesconectar = vi.fn().mockResolvedValue(revocada);

    await montar({
      cargarCuentas: async () => [inicial],
      onDesconectar,
    });

    fireEvent.click(screen.getByRole("button", { name: "Desconectar" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirmar desconexión" }));
    });

    expect(onDesconectar).toHaveBeenCalledTimes(1);
    expect(onDesconectar).toHaveBeenCalledWith("c1");
    expect(screen.getByRole("list", { name: "Tus cuentas conectadas" })).toHaveTextContent("Desconectada");
  });

  it("permite reautorizar una cuenta que requiere reautorización", async () => {
    const pendiente = cuenta({
      id: "c2",
      estado: "requiere_reautorizacion",
      estado_legible: "Requiere reautorización",
      necesita_reautorizacion: true,
    });
    const onReautorizar = vi.fn().mockResolvedValue("https://accounts.google.com/o/oauth2/v2/auth?client_id=x");
    const redirigir = vi.fn();

    await montar({
      cargarCuentas: async () => [pendiente],
      onReautorizar,
      redirigir,
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Volver a autorizar" }));
    });

    expect(onReautorizar).toHaveBeenCalledWith("gmail");
    expect(redirigir).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?client_id=x");
  });
it("no redirige ni muestra mensajes si se abandona la página antes de resolver o rechazar la reautorización", async () => {
    const pendiente = cuenta({
      id: "c2",
      estado: "requiere_reautorizacion",
      estado_legible: "Requiere reautorización",
      necesita_reautorizacion: true,
    });
    let resolver!: (url: string) => void;
    const onReautorizar = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolver = res;
        }),
    );
    const redirigir = vi.fn();

    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/cuentas"]}>
          <ToastProvider>
            <AuthProvider>
              <Routes>
                <Route
                  path="/cuentas"
                  element={
                    <CuentasConectadasPage
                      cargarCuentas={async () => [pendiente]}
                      onReautorizar={onReautorizar}
                      redirigir={redirigir}
                    />
                  }
                />
                <Route path="/dashboard" element={<div>Panel principal</div>} />
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await act(async () => {});

    fireEvent.click(screen.getByRole("button", { name: "Volver a autorizar" }));
    expect(onReautorizar).toHaveBeenCalledTimes(1);

    // El usuario navega fuera de Cuentas mientras onReautorizar sigue pendiente.
    fireEvent.click(screen.getByRole("link", { name: "Panel" }));
    expect(screen.getByText("Panel principal")).toBeInTheDocument();

    // La respuesta antigua llega después de abandonar la página.
    await act(async () => {
      resolver("https://accounts.google.com/o/oauth2/v2/auth?client_id=x");
    });

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("invalida la reautorización pendiente de la sesión A cuando cierra sesión y entra la sesión B", async () => {
    const jwt = (sub: string) => {
      const b64 = (o: unknown) =>
        btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      return `${b64({ alg: "HS256" })}.${b64({ sub, exp: Math.floor((Date.now() + 30 * 60_000) / 1000) })}.firma`;
    };

    const pendienteA = cuenta({
      id: "c-a",
      cuenta_externa: "usuario.a@gmail.com",
      estado: "requiere_reautorizacion",
      estado_legible: "Requiere reautorización",
      necesita_reautorizacion: true,
    });
    const conectadaB = cuenta({
      id: "c-b",
      cuenta_externa: "usuario.b@gmail.com",
      estado: "conectada",
      estado_legible: "Conectada",
    });

    let resolverA!: (url: string) => void;
    const onReautorizar = vi.fn().mockImplementation(
      () =>
        new Promise<string>((res) => {
          resolverA = res;
        }),
    );
    const redirigir = vi.fn();

    let apiAuth!: ReturnType<typeof useAuth>;
    function CapturadorAuth() {
      apiAuth = useAuth();
      return null;
    }

    let listaActual = [pendienteA];
    render(
      <StrictMode>
        <MemoryRouter initialEntries={["/cuentas"]}>
          <ToastProvider>
            <AuthProvider>
              <CapturadorAuth />
              <CuentasConectadasPage
                cargarCuentas={async () => listaActual}
                onReautorizar={onReautorizar}
                redirigir={redirigir}
              />
            </AuthProvider>
          </ToastProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    await act(async () => {
      apiAuth.iniciarSesion({ access_token: jwt("7"), refresh_token: jwt("7-r") });
    });

    // Sesión A inicia reautorización y queda pendiente.
    fireEvent.click(screen.getByRole("button", { name: "Volver a autorizar" }));
    expect(onReautorizar).toHaveBeenCalledTimes(1);

    // Cierre de sesión A → entrada sesión B.
    listaActual = [conectadaB];
    await act(async () => {
      apiAuth.cerrarSesionLocal();
      apiAuth.iniciarSesion({ access_token: jwt("8"), refresh_token: jwt("8-r") });
    });

    expect(screen.getByText("usuario.b@gmail.com")).toBeInTheDocument();

    // Llega la respuesta tardía de A: no debe redirigir ni mostrar toasts en B.
    await act(async () => {
      resolverA("https://accounts.google.com/o/oauth2/v2/auth?client_id=x");
    });

    expect(redirigir).not.toHaveBeenCalled();
    expect(screen.queryByText(/No pudimos iniciar la reautorización/)).not.toBeInTheDocument();
  });
