// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAVE_TEMA, iniciarTema, useTema } from "./useTema";

const html = document.documentElement;

beforeEach(() => {
  localStorage.clear();
  delete html.dataset.tema;
  document.head.innerHTML = '<meta name="theme-color" content="#0a0e1a" />';
  // jsdom no carga theme.css: se ponen a mano los dos --fondo, como los define.
  html.style.removeProperty("--fondo");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Tema (CH-24)", () => {
  it("sin nada guardado, oscuro", () => {
    iniciarTema();
    expect(html.dataset.tema).toBe("oscuro");
  });

  it("al iniciar respeta lo guardado: el tema se conserva al recargar", () => {
    localStorage.setItem(CLAVE_TEMA, "claro");
    iniciarTema();
    expect(html.dataset.tema).toBe("claro");
  });

  it("un valor guardado que no es un tema se ignora", () => {
    localStorage.setItem(CLAVE_TEMA, "sepia");
    iniciarTema();
    expect(html.dataset.tema).toBe("oscuro");
  });

  it("elegir un tema lo aplica a toda la página y lo guarda", () => {
    const { result } = renderHook(useTema);
    act(() => result.current[1]("claro"));
    expect(html.dataset.tema).toBe("claro");
    expect(localStorage.getItem(CLAVE_TEMA)).toBe("claro");
    // Otra pantalla que lo lea después (navegar) ve el mismo.
    const otra = renderHook(useTema);
    expect(otra.result.current[0]).toBe("claro");
  });

  it("sin localStorage (modo privado) el tema igual se aplica", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const { result } = renderHook(useTema);
    expect(result.current[0]).toBe("oscuro");
    act(() => result.current[1]("claro"));
    expect(html.dataset.tema).toBe("claro");
  });

  it("la barra del navegador toma el fondo del tema", () => {
    html.style.setProperty("--fondo", "#eef1f8");
    localStorage.setItem(CLAVE_TEMA, "claro");
    iniciarTema();
    expect(document.querySelector('meta[name="theme-color"]')).toHaveProperty("content", "#eef1f8");
  });
});

describe("index.html pone el tema antes de pintar (CH-24)", () => {
  // En jsdom import.meta.url no es file://: las pruebas corren desde frontend/web.
  const indexHtml = readFileSync(resolve(process.cwd(), "index.html"), "utf-8");
  const script = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  it("hay un único script en línea, antes del de la app, y usa la misma clave", () => {
    expect(script).toHaveLength(1);
    expect(script[0]).toContain(`'${CLAVE_TEMA}'`);
    expect(indexHtml.indexOf("<script>")).toBeLessThan(indexHtml.indexOf('<script type="module"'));
  });

  it.each([
    ["claro", "claro"],
    ["oscuro", "oscuro"],
    ["sepia", undefined],
  ])("con %s guardado deja data-tema = %s", (guardado, esperado) => {
    localStorage.setItem(CLAVE_TEMA, guardado);
    new Function(script[0])();
    expect(html.dataset.tema).toBe(esperado);
  });

  it("si localStorage falla no rompe la carga", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    expect(() => new Function(script[0])()).not.toThrow();
  });
});
