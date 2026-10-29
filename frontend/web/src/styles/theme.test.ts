import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CH-24: los colores del tema se leen igual en claro y en oscuro. Se calcula
// el contraste WCAG de cada token que se usa como letra contra los fondos
// donde aparece: el fondo de la página, un tile de vidrio y la superficie
// sólida (modales). Si alguien cambia un token y baja de 4,5:1, falla acá.

const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf-8');

type Rgba = [number, number, number, number];

function bloque(selector: string): string {
  const inicio = css.indexOf(selector);
  if (inicio < 0) throw new Error(`No está el bloque ${selector}`);
  return css.slice(css.indexOf('{', inicio) + 1, css.indexOf('}', inicio));
}

function tokens(texto: string): Record<string, string> {
  return Object.fromEntries([...texto.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

const OSCURO = tokens(bloque(":root[data-tema='oscuro']"));
// El claro solo redefine lo que cambia; lo demás lo hereda de :root.
const CLARO = { ...OSCURO, ...tokens(bloque(":root[data-tema='claro']")) };

function color(valor: string): Rgba {
  const hex = valor.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = valor.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const [r, g, b, a = 1] = rgba[1].split(',').map(Number);
    return [r, g, b, a];
  }
  throw new Error(`Color que el test no entiende: ${valor}`);
}

/** `arriba` (con su alfa) pintado sobre `abajo` (opaco). */
function sobre(arriba: Rgba, abajo: Rgba): Rgba {
  const a = arriba[3];
  return [0, 1, 2].map((i) => arriba[i] * a + abajo[i] * (1 - a)).concat(1) as Rgba;
}

function luminancia([r, g, b]: Rgba): number {
  const f = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contraste(a: Rgba, b: Rgba): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

// Los colores que se usan como letra (o como ícono que lleva información).
const DE_TEXTO = ['tinta', 'tinta-2', 'tinta-3', 'acento-texto', 'verde', 'turquesa', 'morado', 'azul', 'coral'];
// Las insignias pintan el color sobre su propio tinte.
const CON_TINTE: [string, string][] = [
  ['acento-texto', 'acento-suave'],
  ['verde', 'verde-suave'],
  ['turquesa', 'turquesa-suave'],
  ['morado', 'morado-suave'],
  ['azul', 'azul-suave'],
  ['coral', 'coral-suave'],
];

describe.each([
  ['oscuro', OSCURO],
  ['claro', CLARO],
] as const)('tema %s (CH-24)', (_, t) => {
  const fondo = color(t.fondo);
  const fondos = {
    fondo,
    tile: sobre(color(t.vidrio), fondo),
    'superficie-solida': color(t['superficie-solida']),
  };

  it.each(DE_TEXTO)('--%s llega a 4,5:1 sobre el fondo, los tiles y los modales', (token) => {
    for (const [donde, base] of Object.entries(fondos)) {
      expect(contraste(color(t[token]), base), `--${token} sobre ${donde}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(CON_TINTE)('--%s se lee sobre --%s (insignias)', (letra, tinte) => {
    const base = sobre(color(t[tinte]), fondos.tile);
    expect(contraste(color(t[letra]), base)).toBeGreaterThanOrEqual(4.5);
  });

  it('la letra de los botones se lee sobre su relleno', () => {
    // El primario es un degradado de --acento-hover a --acento: los dos extremos.
    expect(contraste(color(t['acento-tinta']), color(t.acento))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(color(t['acento-tinta']), color(t['acento-hover']))).toBeGreaterThanOrEqual(4.5);
    expect(contraste(color(t['coral-tinta']), color(t.coral))).toBeGreaterThanOrEqual(4.5);
  });

  it('el borde de foco se distingue del fondo (3:1, WCAG 1.4.11)', () => {
    for (const base of Object.values(fondos)) {
      expect(contraste(color(t.foco), base)).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('uso de los tokens en los estilos (CH-24)', () => {
  // --acento es el relleno y en claro no llega a 4,5:1 como letra.
  it('la letra naranja usa --acento-texto, no --acento', () => {
    const raiz = new URL('../', import.meta.url);
    const archivos = readdirSync(raiz, { recursive: true, encoding: 'utf-8' }).filter((f) => f.endsWith('.css'));
    const conAcentoComoLetra = archivos.filter((f) =>
      /(?<![-\w])color:\s*var\(--acento\)/.test(readFileSync(new URL(f.replace(/\\/g, '/'), raiz), 'utf-8')),
    );
    expect(archivos.length).toBeGreaterThan(20);
    expect(conAcentoComoLetra).toEqual([]);
  });
});

describe('cálculo de contraste', () => {
  it('coincide con los valores conocidos de WCAG', () => {
    expect(contraste([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 1);
    expect(contraste([118, 118, 118, 1], [255, 255, 255, 1])).toBeCloseTo(4.54, 2);
  });
});
