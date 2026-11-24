// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ELIMINAR_CUENTA_DISPONIBLE, ELIMINAR_CUENTA_WEB_DISPONIBLE } from "@ojoalgasto/shared";
import { ConfiguracionPage } from "./ConfiguracionPage";

// S3-AN-03: Eliminar cuenta está habilitado también en Ajustes. Se simulan el layout y los
// avisos (hacen sus propias peticiones); el botón y el diálogo son los reales.
vi.mock("../components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../components/Configuracion/PreferenciasAvisos", () => ({ PreferenciasAvisos: () => null }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ cerrarSesionLocal: () => true, capturarSesion: () => 1 }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => ({ exito: vi.fn() }) }));

afterEach(() => {
  cleanup();
});

describe("Eliminar cuenta en Ajustes (S3-AN-03)", () => {
  it("la bandera web está habilitada y la de móvil sigue apagada (AN-19 sin protección de sesión)", () => {
    expect(ELIMINAR_CUENTA_WEB_DISPONIBLE).toBe(true);
    expect(ELIMINAR_CUENTA_DISPONIBLE).toBe(false);
  });

  it("el botón está activo y abre el diálogo con contraseña y confirmación explícita", () => {
    render(
      <MemoryRouter>
        <ConfiguracionPage />
      </MemoryRouter>,
    );
    const boton = screen.getByRole("button", { name: /^Eliminar$/ }) as HTMLButtonElement;
    expect(boton.disabled).toBe(false);
    fireEvent.click(boton);
    expect(screen.getByLabelText("Tu contraseña actual")).toBeInTheDocument();
    expect(screen.getByLabelText("Escribe ELIMINAR para confirmar")).toBeInTheDocument();
    expect((screen.getByRole("button", { name: "Eliminar mi cuenta" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
