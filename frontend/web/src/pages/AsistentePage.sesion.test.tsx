// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consultarAsistente,
  getUsuarioActual,
  guardarTokens,
  obtenerAccessToken,
  revocarSesion,
  type RespuestaAsistente,
  type Usuario,
} from "@ojoalgasto/shared";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { RutaPrivada } from "../components/RutaPrivada";
import { crearTokenDePrueba } from "../test/tokensDePrueba";
import { AsistentePage } from "./AsistentePage";

// Misma revisión que #128 para Recomendaciones: AuthProvider, guarda privada,
// tokens y página reales; solo se simula la red.
vi.mock("@ojoalgasto/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@ojoalgasto/shared")>();
  return { ...real, consultarAsistente: vi.fn(), getUsuarioActual: vi.fn(), revocarSesion: vi.fn() };
});
const consultarAsistenteMock = vi.mocked(consultarAsistente);
const getUsuarioActualMock = vi.mocked(getUsuarioActual);

const PERSONA_A: Usuario = { id: "7", nombre: "Ana", correo: "ana@ejemplo.com", rol: "titular", organizacion_id: "org-a", plan: "premium" };
const PERSONA_B: Usuario = { ...PERSONA_A, id: "8", nombre: "Bruno", correo: "bruno@ejemplo.com", organizacion_id: "org-b" };

const PREGUNTA_DE_A = "¿Cuánto gasta mi organización en Netflix?";
const RESPUESTA_PRIVADA_DE_A: RespuestaAsistente = { estado: "ok", motivo: null, respuesta: "Respuesta privada de A: pagan 12.000 en Netflix." };
const RESPUESTA_PARA_B: RespuestaAsistente = { estado: "ok", motivo: null, respuesta: "Respuesta para B: no hay datos todavía." };

const TOKEN_A = crearTokenDePrueba({ user_id: 7, organizacion_id: "org-a", sid: "sesion-a", jti: "a-1" });
const TOKEN_B = crearTokenDePrueba({ user_id: 8, organizacion_id: "org-b", sid: "sesion-b", jti: "b-1" });

/** Promesa que el test resuelve o rechaza cuando quiere. */
function diferida<T>() {
  let resolver!: (valor: T) => void;
  let rechazar!: (error: unknown) => void;
  const promesa = new Promise<T>((alResolver, alRechazar) => {
    resolver = alResolver;
    rechazar = alRechazar;
  });
  return { promesa, resolver, rechazar };
}

function IrAOtraPagina() {
  const navegar = useNavigate();
  return <button onClick={() => navegar("/otra")}>Ir a otra página</button>;
}
function VolverAlAsistente() {
  const navegar = useNavigate();
  return <button onClick={() => navegar("/asistente")}>Volver al asistente</button>;
}

async function montar() {
  render(
    <MemoryRouter initialEntries={["/asistente"]}>
      <ToastProvider>
        <AuthProvider>
          <IrAOtraPagina />
          <VolverAlAsistente />
          <Routes>
            <Route path="/login" element={<h1>Login</h1>} />
            <Route element={<RutaPrivada />}>
              <Route path="/asistente" element={<AsistentePage />} />
              <Route path="/otra" element={<h1>Otra página</h1>} />
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
  await act(async () => {});
}

/** Otra pestaña guarda otros tokens: a esta solo le llega el evento `storage`. */
async function otraPestanaGuarda(access: string) {
  await act(async () => {
    guardarTokens({ access_token: access, refresh_token: `refresh-${access.slice(-12)}` });
    window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
  });
}

const cuadroDeLaPregunta = () => screen.getByRole("textbox", { name: "Tu pregunta" });
const conversacion = () => within(screen.getByRole("log", { name: "Conversación" }));
const preguntar = async (pregunta: string) => {
  fireEvent.change(cuadroDeLaPregunta(), { target: { value: pregunta } });
  await act(async () => fireEvent.keyDown(cuadroDeLaPregunta(), { key: "Enter" }));
};

beforeEach(() => {
  localStorage.clear();
  guardarTokens({ access_token: TOKEN_A, refresh_token: "refresh-a" });
  getUsuarioActualMock.mockReset().mockImplementation(async () => (obtenerAccessToken() === TOKEN_B ? PERSONA_B : PERSONA_A));
  consultarAsistenteMock.mockReset();
  vi.mocked(revocarSesion).mockReset().mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
});

describe("Asistente al cambiar de sesión (regla de sesión de Integra III)", () => {
  it("la respuesta de A que llega después de entrar B no aparece en la conversación de B", async () => {
    const respuestaDeA = diferida<RespuestaAsistente>();
    consultarAsistenteMock.mockReturnValueOnce(respuestaDeA.promesa);
    await montar();
    await preguntar(PREGUNTA_DE_A);
    expect(conversacion().getByText(PREGUNTA_DE_A)).toBeInTheDocument();

    await otraPestanaGuarda(TOKEN_B);

    // La página se vuelve a montar con B: la pregunta de A ya no está, ni el aviso de espera.
    expect(screen.queryByText(PREGUNTA_DE_A)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await act(async () => respuestaDeA.resolver(RESPUESTA_PRIVADA_DE_A));

    expect(screen.queryByText(RESPUESTA_PRIVADA_DE_A.respuesta)).not.toBeInTheDocument();
    expect(conversacion().queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("un error de A que llega tarde no aparece como alerta en la vista de B", async () => {
    const respuestaDeA = diferida<RespuestaAsistente>();
    consultarAsistenteMock.mockReturnValueOnce(respuestaDeA.promesa);
    await montar();
    await preguntar(PREGUNTA_DE_A);

    await otraPestanaGuarda(TOKEN_B);
    await act(async () => respuestaDeA.rechazar(new TypeError("Failed to fetch")));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
  });

  it("B puede preguntar mientras la respuesta de A sigue pendiente, y la de A no se mezcla con la suya", async () => {
    const respuestaDeA = diferida<RespuestaAsistente>();
    consultarAsistenteMock.mockReturnValueOnce(respuestaDeA.promesa).mockResolvedValueOnce(RESPUESTA_PARA_B);
    await montar();
    await preguntar(PREGUNTA_DE_A);

    await otraPestanaGuarda(TOKEN_B);
    // El envío pendiente de A no bloquea a B: es otra página montada, sin espera en curso.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await preguntar("¿Hay algo que revisar?");
    expect(conversacion().getAllByRole("listitem")).toHaveLength(2);

    await act(async () => respuestaDeA.resolver(RESPUESTA_PRIVADA_DE_A));

    const mensajes = conversacion().getAllByRole("listitem");
    expect(mensajes).toHaveLength(2);
    expect(mensajes[1]).toHaveTextContent(RESPUESTA_PARA_B.respuesta);
    expect(screen.queryByText(RESPUESTA_PRIVADA_DE_A.respuesta)).not.toBeInTheDocument();
    expect(screen.queryByText(PREGUNTA_DE_A)).not.toBeInTheDocument();
  });

  it("si se sale de la página con una respuesta pendiente, al volver la conversación está vacía y la respuesta no aparece", async () => {
    const respuestaPendiente = diferida<RespuestaAsistente>();
    consultarAsistenteMock.mockReturnValueOnce(respuestaPendiente.promesa);
    await montar();
    await preguntar(PREGUNTA_DE_A);

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Ir a otra página" })));
    expect(screen.getByRole("heading", { name: "Otra página" })).toBeInTheDocument();
    await act(async () => respuestaPendiente.resolver(RESPUESTA_PRIVADA_DE_A));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Volver al asistente" })));

    expect(screen.queryByText(RESPUESTA_PRIVADA_DE_A.respuesta)).not.toBeInTheDocument();
    expect(screen.queryByText(PREGUNTA_DE_A)).not.toBeInTheDocument();
    expect(conversacion().queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/Todavía no hay mensajes/)).toBeInTheDocument();
  });
});
