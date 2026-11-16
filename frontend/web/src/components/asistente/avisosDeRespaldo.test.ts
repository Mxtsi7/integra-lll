import { describe, expect, it } from 'vitest';
import {
  ENCABEZADO_DE_RESPALDO,
  MOTIVOS_DE_RESPALDO_CONOCIDOS,
  TEXTO_DE_RESPALDO_GENERAL,
  textoDeRespaldo,
} from './avisosDeRespaldo';

// Los motivos que manda POST /api/asistente/ (services/analytics/analytics/politica_ia.py).
const MOTIVOS_DEL_BACKEND = [
  'no_configurado',
  'timeout',
  'proveedor_no_disponible',
  'cuota_agotada',
  'cuota_no_disponible',
  'capacidad',
  'respuesta_invalida',
];

describe('avisos de respaldo del asistente (S3-CH-17)', () => {
  it('cada motivo que manda el backend tiene su propio texto, distinto del general', () => {
    for (const motivo of MOTIVOS_DEL_BACKEND) {
      const texto = textoDeRespaldo(motivo);
      expect(texto, motivo).not.toBe(TEXTO_DE_RESPALDO_GENERAL);
      expect(texto.causa.trim(), motivo).not.toBe('');
      expect(texto.recuperacion.trim(), motivo).not.toBe('');
    }
  });

  it('la web no tiene textos para motivos que el backend no manda', () => {
    expect([...MOTIVOS_DE_RESPALDO_CONOCIDOS].sort()).toEqual([...MOTIVOS_DEL_BACKEND].sort());
  });

  it('dos motivos distintos no dicen la misma causa', () => {
    const causas = MOTIVOS_DEL_BACKEND.map((motivo) => textoDeRespaldo(motivo).causa);
    expect(new Set(causas).size).toBe(causas.length);
  });

  // Con estos dos motivos preguntar otra vez da lo mismo: la cuota se renueva al
  // cambiar el mes y la configuración del proveedor no depende de la persona.
  it.each(['cuota_agotada', 'no_configurado'])('con el motivo %s no se invita a volver a preguntar', (motivo) => {
    expect(textoDeRespaldo(motivo).recuperacion).not.toMatch(/volver a preguntar|vuelve a preguntar|reintent/i);
    expect(textoDeRespaldo(motivo).recuperacion).toMatch(/recibirás este resumen automático/);
  });

  it('con la cuota agotada se dice cuándo vuelve el asistente con IA: el próximo mes', () => {
    expect(textoDeRespaldo('cuota_agotada').causa).toMatch(/de este mes/);
    expect(textoDeRespaldo('cuota_agotada').recuperacion).toMatch(/Hasta el próximo mes/);
  });

  it.each(['timeout', 'proveedor_no_disponible', 'cuota_no_disponible', 'capacidad', 'respuesta_invalida'])(
    'con el motivo %s, que es pasajero, sí se invita a volver a preguntar',
    (motivo) => {
      expect(textoDeRespaldo(motivo).recuperacion).toMatch(/volver a preguntar|Vuelve a preguntar/);
    },
  );

  it('el motivo null y uno desconocido dan el texto general', () => {
    expect(textoDeRespaldo(null)).toBe(TEXTO_DE_RESPALDO_GENERAL);
    expect(textoDeRespaldo('motivo_nuevo_del_backend')).toBe(TEXTO_DE_RESPALDO_GENERAL);
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'el motivo "%s" no encuentra nada en los objetos de JavaScript: da el texto general',
    (motivo) => {
      expect(textoDeRespaldo(motivo)).toBe(TEXTO_DE_RESPALDO_GENERAL);
    },
  );

  it('el encabezado dice que el texto es un resumen automático y no la respuesta de la IA', () => {
    expect(ENCABEZADO_DE_RESPALDO).toBe('Resumen automático.');
  });
});
