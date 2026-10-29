// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode, useEffect, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

afterEach(() => {
  cleanup();
});

/** Un botón que abre el modal, como en las páginas. */
function ConAbridor({ alCerrar, contenido }: { alCerrar?: () => void; contenido?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierto(true)}>
        Abrir
      </button>
      <button type="button">Algo de la página</button>
      {abierto && (
        <Modal
          titulo="Nueva suscripción"
          descripcion="Lo que pagas y cuándo."
          alCerrar={() => {
            alCerrar?.();
            setAbierto(false);
          }}
        >
          {contenido ?? (
            <form>
              <button type="button">Actualizar opciones</button>
              <label htmlFor="nombre">Nombre</label>
              <input id="nombre" />
              <label htmlFor="monto">Monto</label>
              <input id="monto" />
              <button type="submit">Guardar</button>
            </form>
          )}
        </Modal>
      )}
    </>
  );
}

const abrir = () => {
  const boton = screen.getByRole("button", { name: "Abrir" });
  boton.focus();
  fireEvent.click(boton);
  return boton;
};
const tab = (shift = false) => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: shift });

describe("Foco del modal (CH-25)", () => {
  it("empieza en el primer campo, aunque antes haya un botón", () => {
    render(<ConAbridor />);
    abrir();
    expect(screen.getByLabelText("Nombre")).toHaveFocus();
  });

  it("sin campos empieza en el primer botón que no es la X; con autoFocus, en ese", () => {
    render(
      <ConAbridor
        contenido={
          <>
            <button type="button">Volver</button>
            <button type="button">Eliminar</button>
          </>
        }
      />,
    );
    abrir();
    expect(screen.getByRole("button", { name: "Volver" })).toHaveFocus();
    cleanup();

    render(
      <ConAbridor
        contenido={
          <>
            <input aria-label="Buscar" />
            <button type="button" data-autofocus>
              Elegido
            </button>
          </>
        }
      />,
    );
    abrir();
    expect(screen.getByRole("button", { name: "Elegido" })).toHaveFocus();
  });

  it("Tab en el último vuelve al primero y Shift+Tab en el primero va al último: no sale a la página", () => {
    render(<ConAbridor />);
    abrir();
    const cerrar = screen.getByRole("button", { name: "Cerrar" }); // primero en el orden: está en la cabecera
    const guardar = screen.getByRole("button", { name: "Guardar" }); // último

    guardar.focus();
    tab();
    expect(cerrar).toHaveFocus();

    tab(true);
    expect(guardar).toHaveFocus();
  });

  it("si el foco quedó afuera (p. ej. un clic en la página), Tab lo trae de vuelta", () => {
    render(<ConAbridor />);
    abrir();
    screen.getByRole("button", { name: "Algo de la página" }).focus();
    tab();
    expect(screen.getByRole("button", { name: "Cerrar" })).toHaveFocus();
  });

  it("al cerrar, el foco vuelve a lo que lo abrió", () => {
    render(<ConAbridor />);
    const abridor = abrir();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(abridor).toHaveFocus();
  });

  it("si el contenido enfoca su propio campo al montarse, se respeta y al cerrar igual vuelve a lo que lo abrió", () => {
    // Como el formulario de Nueva suscripción: su efecto corre antes que el del modal.
    function FormularioQueEnfoca() {
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => ref.current?.focus(), []);
      return (
        <>
          <label htmlFor="primero">Primero</label>
          <input id="primero" />
          <label htmlFor="elegido">Elegido</label>
          <input id="elegido" ref={ref} />
        </>
      );
    }
    // En StrictMode, como main.tsx: los efectos corren dos veces al montar.
    render(
      <StrictMode>
        <ConAbridor contenido={<FormularioQueEnfoca />} />
      </StrictMode>,
    );
    const abridor = abrir();
    expect(screen.getByLabelText("Elegido")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(abridor).toHaveFocus(); // antes quedaba en <body>
  });

  it("si lo que lo abrió ya no existe, cerrar no rompe nada", () => {
    function SeVa() {
      const [abierto, setAbierto] = useState(true);
      const [conAbridor, setConAbridor] = useState(true);
      return (
        <>
          {conAbridor && <button type="button">Fila</button>}
          {abierto && (
            <Modal
              titulo="¿Eliminar?"
              tipo="alerta"
              alCerrar={() => {
                setConAbridor(false);
                setAbierto(false);
              }}
            >
              <button type="button">Eliminar</button>
            </Modal>
          )}
        </>
      );
    }
    render(<SeVa />);
    expect(() => fireEvent.keyDown(document, { key: "Escape" })).not.toThrow();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("si el padre pasa un alCerrar nuevo en cada render, el foco no salta y se usa el último", () => {
    const llamadas: string[] = [];
    function Padre() {
      const [texto, setTexto] = useState("");
      return (
        // Una función nueva en cada render, como un alCerrar en línea.
        <Modal titulo="Editar" alCerrar={() => llamadas.push(texto)}>
          <label htmlFor="a">A</label>
          <input id="a" />
          <label htmlFor="b">B</label>
          <input id="b" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Modal>
      );
    }
    render(<Padre />);
    const b = screen.getByLabelText("B");
    b.focus();
    fireEvent.change(b, { target: { value: "hola" } }); // re-render del padre
    expect(b).toHaveFocus(); // antes volvía a "A"
    fireEvent.keyDown(document, { key: "Escape" });
    expect(llamadas).toEqual(["hola"]);
  });
});

describe("Nombre, descripción y Escape del modal (CH-25)", () => {
  it("se nombra con su título y se describe con su descripción", () => {
    render(<ConAbridor />);
    abrir();
    const dialogo = screen.getByRole("dialog", { name: "Nueva suscripción" });
    expect(dialogo).toHaveAccessibleDescription("Lo que pagas y cuándo.");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
  });

  it("dos modales a la vez no comparten ids, y Escape cierra solo el de arriba", () => {
    const cerrarAbajo = vi.fn();
    const cerrarArriba = vi.fn();
    render(
      <>
        <Modal titulo="Abajo" alCerrar={cerrarAbajo}>
          <button type="button">A</button>
        </Modal>
        <Modal titulo="Arriba" descripcion="Encima" alCerrar={cerrarArriba}>
          <button type="button">B</button>
        </Modal>
      </>,
    );
    expect(screen.getByRole("dialog", { name: "Abajo" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Arriba" })).toBeInTheDocument();
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(cerrarArriba).toHaveBeenCalledTimes(1);
    expect(cerrarAbajo).not.toHaveBeenCalled();
  });

  it("tocar el fondo cierra un diálogo, pero no una alerta", () => {
    const cerrar = vi.fn();
    const { rerender, container } = render(
      <Modal titulo="Diálogo" alCerrar={cerrar}>
        <button type="button">x</button>
      </Modal>,
    );
    fireEvent.mouseDown(container.firstElementChild!);
    expect(cerrar).toHaveBeenCalledTimes(1);

    rerender(
      <Modal titulo="Alerta" tipo="alerta" alCerrar={cerrar}>
        <button type="button">x</button>
      </Modal>,
    );
    fireEvent.mouseDown(container.firstElementChild!);
    expect(cerrar).toHaveBeenCalledTimes(1);
  });

  it("mientras está abierto la página no se desplaza, y al cerrar vuelve como estaba", () => {
    document.body.style.overflow = "auto";
    const { unmount } = render(
      <Modal titulo="x" alCerrar={() => {}}>
        <button type="button">x</button>
      </Modal>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    act(() => unmount());
    expect(document.body.style.overflow).toBe("auto");
  });
});
