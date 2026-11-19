// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCuentasConectadas,
  getImportacion,
  type CuentaConectada,
  type Importacion,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { ImportacionPage } from "./ImportacionPage";

// Solo se simula la red. La página y el hook de la cuenta son los reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, getImportacion: vi.fn(), getCuentasConectadas: vi.fn() };
});
const importacionMock = vi.mocked(getImportacion);
const cuentasMock = vi.mocked(getCuentasConectadas);

const CORREO_FALLIDA: Importacion = {
  id: "imp-correo",
  origen: "correo",
  origen_legible: "Lectura de correo",
  nombre_archivo: "",
  estado: "fallida",
  estado_legible: "Fallida",
  terminada: true,
  progreso: 100,
  filas_totales: null,
  filas_procesadas: 0,
  candidatos_detectados: 0,
  candidatos_confirmados: false,
  errores: [
    { codigo: "requiere_reautorizacion", mensaje: "La cuenta necesita que el usuario vuelva a autorizarla.", fila: null },
  ],
  errores_totales: 1,
  terminada_en: "2026-11-18T10:00:00-03:00",
  confirmada_en: null,
  creado_en: "2026-11-18T09:58:00-03:00",
  cuenta: "cta-gmail",
};

const GMAIL: CuentaConectada = {
  id: "cta-gmail",
  proveedor: "gmail",
  proveedor_legible: "Gmail",
  cuenta_externa: "ana@ejemplo.test",
  estado: "requiere_reautorizacion",
  estado_legible: "Requiere reautorización",
  detalle_del_estado: "el proveedor revocó el permiso",
  necesita_reautorizacion: true,
  token_expira_en: null,
  ultima_sincronizacion: null,
  creado_en: "2026-10-01T10:00:00-03:00",
  actualizado_en: "2026-11-18T10:00:00-03:00",
};

const GMAIL_SANA: CuentaConectada = {
  ...GMAIL,
  estado: "conectada",
  estado_legible: "Conectada",
  detalle_del_estado: "",
  necesita_reautorizacion: false,
};

function montar(ruta = "/importaciones/imp-correo") {
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/importaciones/:id" element={<ImportacionPage />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const enlaceDeCuentas = () => screen.queryByRole("link", { name: "Revisar cuentas conectadas" });

beforeEach(() => {
  importacionMock.mockReset();
  cuentasMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("la cuenta que necesita volver a autorizarse (S3-CH-22)", () => {
  it("una lectura de correo que falló por autorización dice qué pasa y lleva a Cuentas conectadas", async () => {
    importacionMock.mockResolvedValue(CORREO_FALLIDA);
    cuentasMock.mockResolvedValue([GMAIL]);

    montar();

    expect(await screen.findByText(/Tu cuenta de Gmail necesita que la vuelvas a autorizar/)).toBeInTheDocument();
    expect(screen.getByText(/no podemos leer tus correos/)).toBeInTheDocument();
    expect(enlaceDeCuentas()).toHaveAttribute("href", "/cuentas");
  });

  it("una cuenta que ya está sana no pide nada, aunque la importación tenga un error de autorización de antes", async () => {
    importacionMock.mockResolvedValue(CORREO_FALLIDA);
    // La cuenta se volvió a autorizar DESPUÉS de que la importación falló.
    cuentasMock.mockResolvedValue([{ ...GMAIL_SANA, actualizado_en: "2026-11-18T11:00:00-03:00" }]);

    montar();

    await screen.findByText("La cuenta necesita que el usuario vuelva a autorizarla.");
    expect(enlaceDeCuentas()).toBeNull();
    expect(screen.queryByText(/necesita que la vuelvas a autorizar/)).toBeNull();
  });

  it("mientras la cuenta carga no se avisa todavía, y después sí", async () => {
    importacionMock.mockResolvedValue(CORREO_FALLIDA);
    let responder!: (cuentas: CuentaConectada[]) => void;
    cuentasMock.mockReturnValue(new Promise((alResolver) => (responder = alResolver)));

    montar();
    await screen.findByText("La importación no se pudo terminar. No se creó ni cambió ninguna suscripción.");
    expect(enlaceDeCuentas()).toBeNull();

    await act(async () => responder([GMAIL]));

    expect(await screen.findByRole("link", { name: "Revisar cuentas conectadas" })).toBeInTheDocument();
  });

  it("si no se pudo consultar la cuenta, el error de la importación sigue pidiendo volver a autorizar, sin decir el proveedor", async () => {
    importacionMock.mockResolvedValue(CORREO_FALLIDA);
    cuentasMock.mockRejectedValue(new TypeError("Failed to fetch"));

    montar();

    expect(await screen.findByText(/Tu cuenta de correo necesita que la vuelvas a autorizar/)).toBeInTheDocument();
    expect(enlaceDeCuentas()).toHaveAttribute("href", "/cuentas");
  });

  it("un CSV nunca pide reconexión ni consulta cuentas, aunque traiga el mismo código", async () => {
    importacionMock.mockResolvedValue({
      ...CORREO_FALLIDA,
      id: "imp-csv",
      origen: "csv",
      origen_legible: "Archivo CSV o cartola",
      nombre_archivo: "septiembre.csv",
      cuenta: null,
    });

    montar("/importaciones/imp-csv");

    await screen.findByText("La importación no se pudo terminar. No se creó ni cambió ninguna suscripción.");
    expect(enlaceDeCuentas()).toBeNull();
    expect(cuentasMock).not.toHaveBeenCalled();
  });
});

describe("una lectura vacía y una fallida no se leen igual (S3-CH-22)", () => {
  it("una lectura de correo que terminó sin cobros dice que terminó y que no encontró ninguno, y no pide nada", async () => {
    importacionMock.mockResolvedValue({
      ...CORREO_FALLIDA,
      estado: "completada",
      estado_legible: "Análisis completado",
      progreso: 100,
      terminada: true,
      errores: [],
      errores_totales: 0,
      candidatos_detectados: 0,
      terminada_en: "2026-11-18T10:00:00-03:00",
      cuenta: null,
    });

    montar();

    expect(await screen.findByText("El análisis terminó.")).toBeInTheDocument();
    expect(screen.getByText("No encontramos cobros que parezcan suscripciones.")).toBeInTheDocument();
    expect(screen.queryByText(/no se pudo terminar/)).toBeNull();
    expect(enlaceDeCuentas()).toBeNull();
  });

  it("una lectura fallida dice que no se pudo terminar y no que no encontró cobros", async () => {
    importacionMock.mockResolvedValue({ ...CORREO_FALLIDA, errores: [], errores_totales: 0, cuenta: null });

    montar();

    expect(await screen.findByText("La importación no se pudo terminar. No se creó ni cambió ninguna suscripción.")).toBeInTheDocument();
    expect(screen.queryByText("No encontramos cobros que parezcan suscripciones.")).toBeNull();
    expect(screen.queryByText("El análisis terminó.")).toBeNull();
  });
});

describe("el aviso sigue lo que le pasa a la cuenta mientras se lee (S3-CH-22)", () => {
  it("una lectura que seguía en curso y después falla por autorización avisa, aunque al abrir la página la cuenta estuviera sana", async () => {
    vi.useFakeTimers();
    // El backend marca la cuenta en el mismo momento en que la lectura falla.
    let laCuentaPideReconexion = false;
    importacionMock
      .mockResolvedValueOnce({
        ...CORREO_FALLIDA,
        estado: "procesando",
        estado_legible: "Procesando",
        terminada: false,
        terminada_en: null,
        progreso: 40,
        errores: [],
        errores_totales: 0,
      })
      .mockImplementation(async () => {
        laCuentaPideReconexion = true;
        return CORREO_FALLIDA;
      });
    cuentasMock.mockImplementation(async () => [laCuentaPideReconexion ? GMAIL : GMAIL_SANA]);

    montar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("Leyendo tus correos…")).toBeInTheDocument();
    expect(enlaceDeCuentas()).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(screen.getByText("La importación no se pudo terminar. No se creó ni cambió ninguna suscripción.")).toBeInTheDocument();
    expect(screen.getByText(/Tu cuenta de Gmail necesita que la vuelvas a autorizar/)).toBeInTheDocument();
    expect(enlaceDeCuentas()).toHaveAttribute("href", "/cuentas");
  });

  it("mientras la lectura sigue en curso no se consulta la cuenta: lo que diga puede cambiar antes de que termine", async () => {
    importacionMock.mockResolvedValue({
      ...CORREO_FALLIDA,
      estado: "procesando",
      estado_legible: "Procesando",
      terminada: false,
      terminada_en: null,
      progreso: 40,
      errores: [],
      errores_totales: 0,
    });
    cuentasMock.mockResolvedValue([GMAIL_SANA]);

    montar();

    await screen.findByText("Leyendo tus correos…");
    expect(cuentasMock).not.toHaveBeenCalled();
  });

  it("un error de autorización que la cuenta no refleja (sin credenciales guardadas) sigue pidiendo reconexión si la cuenta no cambió desde que terminó", async () => {
    importacionMock.mockResolvedValue({
      ...CORREO_FALLIDA,
      errores: [{ codigo: "sin_credenciales", mensaje: "La cuenta no tiene credenciales guardadas.", fila: null }],
    });
    // Sana según el backend (el estado es «conectada»), pero sin tocar desde antes de la falla.
    cuentasMock.mockResolvedValue([{ ...GMAIL_SANA, actualizado_en: "2026-11-18T09:00:00-03:00" }]);

    montar();

    expect(await screen.findByText(/Tu cuenta de Gmail necesita que la vuelvas a autorizar/)).toBeInTheDocument();
    expect(enlaceDeCuentas()).toHaveAttribute("href", "/cuentas");
  });
});
