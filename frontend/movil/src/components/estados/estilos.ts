import { StyleSheet } from 'react-native';

// Valores del tema oscuro de la web (frontend/web/src/styles/theme.css). Cada estado va dentro de su
// propia tarjeta para leerse bien sobre cualquier fondo. Cuando la app móvil tenga tema propio
// (SE-06 / ADR-006), basta cambiar esta constante.
export const COLORES_ESTADOS = {
  tarjeta: '#141a2b', // --superficie-solida
  borde: 'rgba(255, 255, 255, 0.09)', // --vidrio-borde
  bordeFuerte: 'rgba(255, 255, 255, 0.18)', // --vidrio-borde-fuerte
  tinta: '#f3f5f9', // --tinta
  tintaSuave: '#a9b0c2', // --tinta-2
  acento: '#ff8a3d', // --acento
  acentoTinta: '#1a0d05', // --acento-tinta
} as const;

/** Misma altura mínima en los 3 estados: la pantalla no "salta" al cambiar de uno a otro. */
export const estilos = StyleSheet.create({
  caja: {
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORES_ESTADOS.borde,
    backgroundColor: COLORES_ESTADOS.tarjeta,
  },
  titulo: { fontSize: 16, fontWeight: '700', color: COLORES_ESTADOS.tinta, textAlign: 'center' },
  texto: { fontSize: 14, lineHeight: 20, color: COLORES_ESTADOS.tintaSuave, textAlign: 'center' },
  // 44 px de alto: tamaño mínimo táctil recomendado
  boton: {
    marginTop: 8,
    minHeight: 44,
    minWidth: 120,
    paddingHorizontal: 20,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORES_ESTADOS.bordeFuerte,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botonPrimario: { backgroundColor: COLORES_ESTADOS.acento, borderColor: COLORES_ESTADOS.acento },
  botonOff: { opacity: 0.6 },
  botonTexto: { color: COLORES_ESTADOS.tinta, fontWeight: '700', fontSize: 14 },
  botonTextoPrimario: { color: COLORES_ESTADOS.acentoTinta },
});
