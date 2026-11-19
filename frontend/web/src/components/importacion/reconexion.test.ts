import { describe, expect, it } from 'vitest';
import type { CuentaConectada, Importacion } from '@ojoalgasto/shared';
import { CODIGOS_QUE_PIDEN_RECONEXION, hayQueReconectar, type EstadoCuentaDeImportacion } from './reconexion';

const CUENTA_CON_AVISO: CuentaConectada = {
  id: 'cta-gmail',
  proveedor: 'gmail',
  proveedor_legible: 'Gmail',
  cuenta_externa: 'ana@ejemplo.test',
  estado: 'requiere_reautorizacion',
  estado_legible: 'Requiere reautorización',
  detalle_del_estado: 'el proveedor revocó el permiso',
  necesita_reautorizacion: true,
  token_expira_en: null,
  ultima_sincronizacion: null,
  creado_en: '2026-10-01T10:00:00-03:00',
  actualizado_en: '2026-11-01T10:00:00-03:00',
};
const CUENTA_SANA: CuentaConectada = { ...CUENTA_CON_AVISO, estado: 'conectada', estado_legible: 'Conectada', detalle_del_estado: '', necesita_reautorizacion: false };

const IMPORTACION_DE_CORREO: Importacion = {
  id: 'imp-correo',
  origen: 'correo',
  origen_legible: 'Lectura de correo',
  nombre_archivo: '',
  estado: 'fallida',
  estado_legible: 'Fallida',
  terminada: true,
  progreso: 100,
  filas_totales: null,
  filas_procesadas: 0,
  candidatos_detectados: 0,
  candidatos_confirmados: false,
  errores: [],
  errores_totales: 0,
  terminada_en: '2026-11-18T10:00:00-03:00',
  confirmada_en: null,
  creado_en: '2026-11-18T09:58:00-03:00',
  cuenta: 'cta-gmail',
};
const con = (parcial: Partial<Importacion>): Importacion => ({ ...IMPORTACION_DE_CORREO, ...parcial });
const listo = (cuenta: CuentaConectada | null): EstadoCuentaDeImportacion => ({ tipo: 'listo', cuenta });

describe('los códigos que piden reconectar (S3-CH-22)', () => {
  it('son los de autorización, y no los de una credencial que el backend renueva sola', () => {
    expect(CODIGOS_QUE_PIDEN_RECONEXION).toEqual(['requiere_reautorizacion', 'sin_credenciales', 'permiso_insuficiente']);
    expect(CODIGOS_QUE_PIDEN_RECONEXION).not.toContain('credencial_vencida');
  });
});

describe('cuándo hay que pedir que se vuelva a autorizar la cuenta (S3-CH-22)', () => {
  it('una cuenta que el backend marca como que necesita reautorización pide reconexión', () => {
    expect(hayQueReconectar(IMPORTACION_DE_CORREO, listo(CUENTA_CON_AVISO))).toBe(true);
  });

  it('una cuenta sana no pide nada, aunque la importación tenga un error de autorización de antes', () => {
    const conErrorViejo = con({ errores: [{ codigo: 'requiere_reautorizacion', mensaje: 'Hay que autorizar.', fila: null }], errores_totales: 1 });

    expect(hayQueReconectar(conErrorViejo, listo(CUENTA_SANA))).toBe(false);
  });

  it('mientras la cuenta carga no se avisa todavía', () => {
    const conErrorDeAutorizacion = con({ errores: [{ codigo: 'requiere_reautorizacion', mensaje: 'Hay que autorizar.', fila: null }] });

    expect(hayQueReconectar(conErrorDeAutorizacion, { tipo: 'cargando' })).toBe(false);
  });

  it.each(CODIGOS_QUE_PIDEN_RECONEXION)('sin cuenta que consultar, el error «%s» de la importación pide reconexión', (codigo) => {
    const conError = con({ errores: [{ codigo, mensaje: 'Hay que autorizar.', fila: null }], errores_totales: 1 });

    expect(hayQueReconectar(conError, { tipo: 'sin-cuenta' })).toBe(true);
    expect(hayQueReconectar(conError, { tipo: 'error' })).toBe(true);
    expect(hayQueReconectar(conError, listo(null))).toBe(true);
  });

  it('si la cuenta no se pudo consultar, se mira el error de la importación y no se inventa un aviso sin él', () => {
    expect(hayQueReconectar(IMPORTACION_DE_CORREO, { tipo: 'error' })).toBe(false);
  });

  it('una credencial vencida no pide reconexión por sí sola: el backend la renueva', () => {
    const conVencida = con({ errores: [{ codigo: 'credencial_vencida', mensaje: 'El token venció.', fila: null }], errores_totales: 1 });

    expect(hayQueReconectar(conVencida, { tipo: 'sin-cuenta' })).toBe(false);
  });

  it('un error de otro tipo, como un monto ilegible, no pide reconexión', () => {
    const conMonto = con({ errores: [{ codigo: 'monto_invalido', mensaje: 'Monto ilegible.', fila: 12 }], errores_totales: 1 });

    expect(hayQueReconectar(conMonto, { tipo: 'sin-cuenta' })).toBe(false);
  });

  it('un CSV nunca pide reconexión, aunque traiga un código de autorización', () => {
    const csv = con({ origen: 'csv', cuenta: null, errores: [{ codigo: 'requiere_reautorizacion', mensaje: 'x', fila: null }] });

    expect(hayQueReconectar(csv, listo(CUENTA_CON_AVISO))).toBe(false);
  });
});
