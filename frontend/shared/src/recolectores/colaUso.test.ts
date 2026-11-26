import { expect, it, vi } from 'vitest';
import { crearRecolectorUso, construirEventosUso, type OpcionesRecolectorUso } from './colaUso';
import { ErrorDeApi } from '../api/cliente';

const inicio = Date.parse('2026-11-25T12:00:00Z');
const uuid = () => crypto.randomUUID();

function respuestaConsentimiento(recolectorId: string, accion: string) {
  return { recolector_id: recolectorId, origen: 'android' as const,
    estado: accion === 'revocar' ? 'revocado' as const : accion === 'pausar' ? 'pausado' as const : 'activo' as const,
    version_texto: 'uso-v1' as const, desde: new Date(inicio).toISOString(),
    actualizado_en: new Date(inicio).toISOString(), servidor_ahora: new Date(inicio).toISOString(), zona_horaria: 'America/Santiago' };
}

function escenario() {
  let texto: string | null = null;
  let reloj = inicio;
  const opciones: OpcionesRecolectorUso = {
    almacen: { leer: async () => texto, guardar: async valor => { texto = valor; } },
    obtenerSesion: () => 'sesion-A', suscripcionId: uuid(), origen: 'android', uuid, ahora: () => reloj,
    cambiarConsentimiento: async ({ recolectorId, accion }) => respuestaConsentimiento(recolectorId, accion),
  };
  return { opciones, avanzar: () => { reloj += 60_000; return reloj; } };
}

it('une intervalos y corta medianoche local sin perder milisegundos', () => {
  const a = Date.parse('2026-11-25T02:59:59.900Z');
  const eventos = construirEventosUso({ suscripcionId: uuid(), recolectorId: uuid(), origen: 'android',
    inicio: a, fin: a + 300, zona: 'America/Santiago', uuid,
    tramos: [{ inicio: a, fin: a + 200 }, { inicio: a + 100, fin: a + 300 }] });
  expect(eventos).toHaveLength(2);
  expect(eventos.map(e => e.evento.duracion_ms)).toEqual([100, 200]);
  expect(eventos.every(e => JSON.stringify(e.evento).length <= 4096)).toBe(true);
});

it('guarda cola y cursor antes de enviar; al reiniciar reintenta el mismo evento', async () => {
  let guardado: string | null = null;
  let sesion: string | null = 'sesion-A';
  let ahora = inicio;
  const enviar = vi.fn(async (pendiente, confirmar) => {
    expect(JSON.parse(guardado!).pendientes[0]).toEqual(pendiente);
    if (enviar.mock.calls.length === 1) throw new Error('sin red');
    await confirmar({ sesionId: 'sesion-A', recolectorId: pendiente.evento.recolector_id,
      suscripcionId: pendiente.suscripcion_id, eventId: pendiente.evento.event_id, recibidoEn: '2026-11-25T12:02:00.000Z' });
    return { event_id: pendiente.evento.event_id, suscripcion_id: pendiente.suscripcion_id,
      estado: 'aceptado' as const, recibido_en: '2026-11-25T12:02:00.000Z' };
  });
  const opciones = { almacen: { leer: async () => guardado, guardar: async (v: string) => { guardado = v; } },
    obtenerSesion: () => sesion, suscripcionId: uuid(), origen: 'android' as const, uuid,
    ahora: () => ahora, enviar,
    cambiarConsentimiento: vi.fn(async ({ recolectorId, accion }) => ({ recolector_id: recolectorId,
      origen: 'android' as const, estado: accion === 'revocar' ? 'revocado' as const : 'activo' as const,
      version_texto: 'uso-v1' as const, desde: new Date(inicio).toISOString(),
      actualizado_en: new Date(ahora).toISOString(), servidor_ahora: new Date(ahora).toISOString(), zona_horaria: 'America/Santiago' })) };
  const primero = crearRecolectorUso(opciones);
  await primero.aceptar();
  ahora += 60_000;
  await primero.capturar(ahora, [{ inicio, fin: ahora }]);
  await primero.sincronizar();
  const pendiente = JSON.parse(guardado!).pendientes[0];
  expect(JSON.parse(guardado!).ultimoEnvio).toBeUndefined();
  ahora += 120_000;
  const reiniciado = crearRecolectorUso(opciones);
  await reiniciado.sincronizar();
  expect(enviar.mock.calls[1][0]).toEqual(pendiente);
  expect(JSON.parse(guardado!).pendientes).toEqual([]);
  expect((await reiniciado.estado())?.ultimoEnvio).toBe('2026-11-25T12:02:00.000Z');
  sesion = 'sesion-B';
  await expect(reiniciado.capturar(ahora + 1, [])).rejects.toThrow();
});

it('no avanza cursor si el guardado falla y revocar cancela inmediatamente un envío', async () => {
  let guardado: string | null = null;
  let fallar = false;
  let ahora = inicio;
  let señal: AbortSignal | undefined;
  const opciones: OpcionesRecolectorUso = {
    almacen: { leer: async () => guardado, guardar: async (v: string) => { if (fallar) throw new Error('disco'); guardado = v; } },
    obtenerSesion: () => 'sesion', suscripcionId: uuid(), origen: 'android' as const, uuid, ahora: () => ahora,
    cambiarConsentimiento: async ({ recolectorId, accion }) => ({ recolector_id: recolectorId, origen: 'android' as const,
      estado: accion === 'revocar' ? 'revocado' as const : 'activo' as const, version_texto: 'uso-v1' as const,
      desde: new Date(inicio).toISOString(), actualizado_en: new Date(ahora).toISOString(),
      servidor_ahora: new Date(ahora).toISOString(), zona_horaria: 'America/Santiago' }),
    enviar: async (_p, _c, opciones) => { señal = opciones?.signal; return new Promise<never>((_r, rechazar) => señal!.addEventListener('abort', () => rechazar(new Error('abortado')))); },
  };
  const control = crearRecolectorUso(opciones);
  await control.aceptar();
  ahora += 60_000;
  fallar = true;
  await expect(control.capturar(ahora, [])).rejects.toThrow('disco');
  expect((await control.estado())?.cursor).toBe(inicio);
  fallar = false;
  await control.capturar(ahora, [{ inicio, fin: ahora }]);
  const envio = control.sincronizar();
  await vi.waitFor(() => expect(señal).toBeDefined());
  const retiro = control.revocar();
  expect(señal!.aborted).toBe(true);
  await Promise.all([envio, retiro]);
  expect((await control.estado())?.fase).toBe('revocado');
  expect((await control.estado())?.pendientes).toHaveLength(0);
});

it('una aceptación que termina de guardar no deshace un retiro solicitado después', async () => {
  const { opciones, avanzar } = escenario();
  const guardar = opciones.almacen.guardar;
  let liberar!: () => void;
  let guardando = false;
  opciones.almacen.guardar = async valor => {
    if (JSON.parse(valor).fase === 'activo') { guardando = true; await new Promise<void>(resolve => { liberar = resolve; }); }
    await guardar(valor);
  };
  const enviar = vi.fn(); opciones.enviar = enviar;
  const control = crearRecolectorUso(opciones);
  const aceptacion = control.aceptar();
  await vi.waitFor(() => expect(guardando).toBe(true));
  const captura = control.capturar(avanzar(), []);
  const resultadoCaptura = expect(captura).rejects.toThrow('consentimiento activo');
  const sincronizacion = control.sincronizar();
  const retiro = control.revocar();
  liberar();
  await Promise.all([aceptacion, resultadoCaptura, sincronizacion, retiro]);
  expect(enviar).not.toHaveBeenCalled();
  expect((await control.estado())?.fase).toBe('revocado');
});

it('refresh temporal conserva los pendientes y un 400 detiene reintentos automáticos', async () => {
  const { opciones, avanzar } = escenario();
  const enviar = vi.fn().mockRejectedValueOnce(new ErrorDeApi('Refresh sin red', 401, undefined,
    { motivo: 'renovacion_temporal', tokenUsado: 'access' })).mockRejectedValue(new ErrorDeApi('Evento inválido', 400));
  opciones.enviar = enviar;
  const control = crearRecolectorUso(opciones);
  await control.aceptar();
  await control.capturar(avanzar(), []);
  await control.sincronizar();
  expect((await control.estado())?.errorPermanente).toBe(false);
  expect((await control.estado())?.fase).toBe('activo');
  avanzar(); await control.sincronizar();
  expect(enviar).toHaveBeenCalledTimes(2);
  expect((await control.estado())?.errorPermanente).toBe(true);
  expect((await control.estado())?.pendientes).toHaveLength(1);
  avanzar(); await control.sincronizar();
  expect(enviar).toHaveBeenCalledTimes(2);
});

it('cancelar consentimiento libera la cola aunque la renovación de auth no responda', async () => {
  const { opciones } = escenario();
  let inicioPeticion = false;
  opciones.cambiarConsentimiento = async ({ recolectorId, accion }) => {
    if (accion === 'aceptar') { inicioPeticion = true; return new Promise(() => {}); }
    return respuestaConsentimiento(recolectorId, accion);
  };
  const control = crearRecolectorUso(opciones);
  const aceptacion = expect(control.aceptar()).rejects.toThrow('cancelada');
  await vi.waitFor(() => expect(inicioPeticion).toBe(true));
  const retiro = control.revocar();
  await Promise.all([aceptacion, retiro]);
  expect((await control.estado())?.fase).toBe('revocado');
});

it('eliminar la suscripción no deja al cliente atrapado en retiro por confirmar', async () => {
  const { opciones } = escenario();
  opciones.cambiarConsentimiento = async ({ recolectorId, accion }) => {
    if (accion === 'revocar') throw new ErrorDeApi('Suscripción inexistente', 404);
    return respuestaConsentimiento(recolectorId, accion);
  };
  const control = crearRecolectorUso(opciones);
  await control.aceptar(); await control.revocar();
  expect((await control.estado())?.fase).toBe('revocado');
  expect((await control.estado())?.accionPendiente).toBeUndefined();
  expect((await control.estado())?.error).toContain('Retiro local');
});
