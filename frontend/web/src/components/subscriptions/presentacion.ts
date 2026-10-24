/**
 * Lo visual de una suscripción, derivado del dato del dominio.
 *
 * `Suscripcion` (de shared) es lo que devuelve la API y con lo que trabajan
 * los cálculos. Los iconos y colores se deciden acá. Las etiquetas del
 * catálogo se consultan en la API y se comparten desde el contexto.
 */

import { useCatalogos } from '../../context/CatalogosContext';
import type { Suscripcion } from '@ojoalgasto/shared';
import {
  Bot,
  Briefcase,
  Cloud,
  Gamepad2,
  GraduationCap,
  HeartPulse,
  Music,
  Newspaper,
  Package,
  Tv,
} from 'lucide-react';
import { diasHasta } from '../../utils/fechas';
import type { TonoInsignia } from '../ui/Insignia';

/** "Netflix" -> "N". */
export function inicialDe(nombre: string): string {
  return (nombre.trim()[0] ?? '?').toUpperCase();
}

/**
 * Cada categoría tiene un icono y una familia de color. El color no dice
 * si algo está bien o mal: eso lo dice el estado. Solo ayuda a reconocer
 * la categoría de un vistazo, como los dispositivos de una casa.
 */
const CATEGORIA_VISUAL: Record<
  Suscripcion['categoria'],
  { Icono: typeof Tv; color: string; suave: string }
> = {
  streaming: { Icono: Tv, color: 'var(--morado)', suave: 'var(--morado-suave)' },
  musica: { Icono: Music, color: 'var(--verde)', suave: 'var(--verde-suave)' },
  productividad: { Icono: Briefcase, color: 'var(--azul)', suave: 'var(--azul-suave)' },
  nube: { Icono: Cloud, color: 'var(--turquesa)', suave: 'var(--turquesa-suave)' },
  juegos: { Icono: Gamepad2, color: 'var(--acento)', suave: 'var(--acento-suave)' },
  educacion: { Icono: GraduationCap, color: 'var(--azul)', suave: 'var(--azul-suave)' },
  salud: { Icono: HeartPulse, color: 'var(--verde)', suave: 'var(--verde-suave)' },
  noticias: { Icono: Newspaper, color: 'var(--turquesa)', suave: 'var(--turquesa-suave)' },
  ia: { Icono: Bot, color: 'var(--morado)', suave: 'var(--morado-suave)' },
  otro: { Icono: Package, color: 'var(--tinta-2)', suave: 'var(--vidrio-2)' },
};

/** Días de anticipación con los que se avisa. RN-NOT-004 usa 48 h. */
const DIAS_DE_AVISO = 2;

/**
 * Si la tarjeta muestra la alerta de cobro cercano.
 *
 * Dos motivos: una prueba gratis que se termina (RN-NOT-004) o un cobro que
 * viene en los próximos días.
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

/** 'mensual' -> '/mes', para pegar al monto. */
export function sufijoFrecuencia(frecuencia: Suscripcion['frecuencia']): string {
  return frecuencia === 'anual' ? '/año' : '/mes';
}

/** Las etiquetas vienen de BD; un código nuevo usa el icono genérico. */
export function usePresentacionCategoria() {
  const { datos } = useCatalogos();
  return (codigo: string) => {
    const visual = Object.prototype.hasOwnProperty.call(CATEGORIA_VISUAL, codigo)
      ? CATEGORIA_VISUAL[codigo] : CATEGORIA_VISUAL.otro;
    return { ...visual, etiqueta: datos?.categorias.find((c) => c.codigo === codigo)?.nombre ?? codigo };
  };
}

/** Cómo se llama cada estado delante del usuario, y de qué color es su insignia. */
export const ESTADOS: Record<Suscripcion['estado'], { etiqueta: string; tono: TonoInsignia }> = {
  activo: { etiqueta: 'Activa', tono: 'verde' },
  prueba: { etiqueta: 'Prueba gratis', tono: 'turquesa' },
  por_confirmar: { etiqueta: 'Por confirmar', tono: 'neutro' },
  fantasma: { etiqueta: 'Sin uso', tono: 'coral' },
  cancelado: { etiqueta: 'Cancelada', tono: 'neutro' },
};

/** "Hoy", "Mañana", "En 5 días". */
export function cuandoEnDias(dias: number): string {
  if (dias === 0) return 'Hoy';
  if (dias === 1) return 'Mañana';
  return `En ${dias} días`;
}
