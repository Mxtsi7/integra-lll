// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consultarAsistente, getPermisosPlan, type PermisosPlan } from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { AsistentePage } from "./AsistentePage";

// Solo se simula la red: la página, el hook de permisos y el chat son reales.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, consultarAsistente: vi.fn(), getPermisosPlan: vi.fn() };
});

const PREMIUM: PermisosPlan = { plan: "premium", features: { asistente_financiero: true, recomendaciones_automaticas: true } };
const GRATUITO: PermisosPlan = { plan: "free", features: { asistente_financiero: false, recomendaciones_automaticas: false } };

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  const promesa = new Promise<T>((alResolver) => {
    resolver = alResolver;
  });
  return { promesa, resolver };
}

const campoDePregunta = () => screen.queryByPlaceholderText("Por ejemplo: ¿Qué suscripción me conviene revisar primero?");

async function montar() {
  render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <AsistentePage />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

beforeEach(() => {
  vi.mocked(getPermisosPlan).mockReset();
  vi.mocked(consultarAsistente).mockReset();
});

afterEach(cleanup);

describe("el asistente según el plan que dice el servidor (S3-CH-16)", () => {
  it("sin el asistente en el plan dice que es de Premium, ofrece verlo y no deja preguntar", async () => {
    vi.mocked(getPermisosPlan).mockResolvedValue(GRATUITO);

    await montar();

    expect(await screen.findByText("El asistente financiero es parte del plan Premium.")).toBeInTheDocument();
    expect(campoDePregunta()).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver planes" })).toHaveAttribute("href", "/perfil");
    expect(consultarAsistente).not.toHaveBeenCalled();
  });

  it("con el asistente en el plan muestra el chat y no la restricción", async () => {
    vi.mocked(getPermisosPlan).mockResolvedValue(PREMIUM);

    await montar();

    expect(await screen.findByPlaceholderText("Por ejemplo: ¿Qué suscripción me conviene revisar primero?")).toBeInTheDocument();
    expect(screen.queryByText("El asistente financiero es parte del plan Premium.")).not.toBeInTheDocument();
  });

  it("mientras comprueba el plan no muestra ni el chat ni la restricción", async () => {
    const plan = diferida<PermisosPlan>();
    vi.mocked(getPermisosPlan).mockReturnValue(plan.promesa);

    await montar();

    expect(screen.getByRole("status", { name: "Comprobando tu plan" })).toBeInTheDocument();
    expect(campoDePregunta()).not.toBeInTheDocument();
    expect(screen.queryByText("El asistente financiero es parte del plan Premium.")).not.toBeInTheDocument();
    await act(async () => plan.resolver(PREMIUM));
  });

  it("si no puede comprobar el plan no concede Premium: lo dice, y Reintentar vuelve a comprobarlo", async () => {
    vi.mocked(getPermisosPlan).mockRejectedValueOnce(new Error("caída")).mockResolvedValueOnce(PREMIUM);

    await montar();

    expect(await screen.findByText("No pudimos comprobar tu plan. Intenta de nuevo.")).toBeInTheDocument();
    expect(campoDePregunta()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByPlaceholderText("Por ejemplo: ¿Qué suscripción me conviene revisar primero?")).toBeInTheDocument();
    expect(getPermisosPlan).toHaveBeenCalledTimes(2);
  });
});
