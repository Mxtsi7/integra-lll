/**
 * Lo visual de una suscripción, derivado del dato del dominio.
 *
 * `Suscripcion` (de shared) es lo que devuelve la API y con lo que trabajan
 * los cálculos. La inicial, el color y la alerta NO son datos: son decisiones
 * de cómo dibujar, así que se calculan acá en vez de viajar por la red.
 */

import type { Suscripcion } from '@ojoalgasto/shared';
import { diasHasta } from '../../utils/fechas';

/** "Netflix" -> "N". Para el círculo de la tarjeta. */
export function inicialDe(nombre: string): string {
  return (nombre.trim()[0] ?? '?').toUpperCase();
}

const PALETA = [
  '#e50914',
  '#1db954',
  '#f5a623',
  '#6c3ce9',
  '#0070d1',
  '#da1f26',
  '#7d2ae8',
];

/**
 * Color estable a partir del nombre: Netflix siempre sale del mismo color,
 * en esta pantalla y en la que venga. Antes salía de un `Math.random()`, así
 * que cambiaba entre recargas y entre pantallas.
 */
export function colorDe(nombre: string): string {
  // Hash de 32 bits (el clásico djb2/Java). Truncar con un módulo dentro del
  // bucle agrupaba los nombres en pocos colores; así se reparten mejor.
  let hash = 0;
  for (let i = 0; i < nombre.length; i += 1) {
    hash = (hash << 5) - hash + nombre.charCodeAt(i);
    hash |= 0;
  }
  return PALETA[Math.abs(hash) % PALETA.length];
}

/** Días de anticipación con los que se avisa. RN-NOT-004 usa 48 h. */
const DIAS_DE_AVISO = 2;

/**
 * Si la tarjeta muestra el triángulo de alerta.
 *
 * Dos motivos: una prueba gratis que se termina (RN-NOT-004) o un cobro que
 * viene en los próximos días. Antes era un `hasAlert` escrito a mano en el
 * JSON de ejemplo, así que no reaccionaba a nada.
 */
export function tieneAlerta(s: Suscripcion): boolean {
  if (s.estado === 'cancelado') return false;

  if (s.estado === 'prueba' && s.fin_prueba) {
    const dias = diasHasta(s.fin_prueba);
    if (dias >= 0 && dias <= DIAS_DE_AVISO) return true;
  }

  const diasParaCobro = diasHasta(s.fecha_proximo_cobro);
  return diasParaCobro >= 0 && diasParaCobro <= DIAS_DE_AVISO;
}

const ETIQUETA_FRECUENCIA: Record<Suscripcion['frecuencia'], string> = {
  mensual: 'Mensual',
  anual: 'Anual',
};

/** 'mensual' -> 'Mensual'. El dominio guarda el valor, la pantalla la etiqueta. */
export function etiquetaFrecuencia(frecuencia: Suscripcion['frecuencia']): string {
  return ETIQUETA_FRECUENCIA[frecuencia];
}

const ETIQUETA_CATEGORIA: Record<Suscripcion['categoria'], string> = {
  streaming: 'Streaming',
  musica: 'Música',
  productividad: 'Productividad',
  nube: 'Nube',
  juegos: 'Juegos',
  educacion: 'Educación',
  salud: 'Salud',
  noticias: 'Noticias',
  ia: 'IA',
  otro: 'Otro',
};

/** Las 10 categorías del dominio, listas para poblar un `<select>`. */
export const CATEGORIAS: { valor: Suscripcion['categoria']; etiqueta: string }[] =
  (Object.keys(ETIQUETA_CATEGORIA) as Suscripcion['categoria'][]).map((valor) => ({
    valor,
    etiqueta: ETIQUETA_CATEGORIA[valor],
  }));

/** 'streaming' -> 'Streaming'. */
export function etiquetaCategoria(categoria: Suscripcion['categoria']): string {
  return ETIQUETA_CATEGORIA[categoria];
}
