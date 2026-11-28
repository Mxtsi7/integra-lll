import { cambiarConsentimientoUso, type AccionConsentimientoUso } from '../api/consentimientoUso';
import { enviarUsoPendiente } from '../api/usoRecolectores';
import { ErrorDeApi } from '../api/cliente';
import type { OrigenRecolector, PendienteUso } from '../contracts/uso-recolectores.dto';

export interface IntervaloUso { inicio: number; fin: number }
export interface EstadoColaUso {
  version: 1; sesionId: string; suscripcionId: string; recolectorId: string; origen: OrigenRecolector;
  fase: 'pendiente' | 'activo' | 'pausado' | 'revocando' | 'revocado';
  cursor: number; zona: string; desfaseMs: number; pendientes: PendienteUso[];
  accionPendiente?: 'pausar' | 'revocar'; ultimoEnvio?: string;
  fallos: number; siguienteIntento: number; error?: string; errorPermanente?: boolean;
}

/** Unión exacta y separación por día local; no transmite paquetes ni dominios. */
export function construirEventosUso(opciones: {
  suscripcionId: string; recolectorId: string; origen: OrigenRecolector; inicio: number; fin: number;
  tramos: readonly IntervaloUso[]; zona: string; uuid: () => string;
}): PendienteUso[] {
  const { inicio, fin } = opciones;
  if (!Number.isSafeInteger(inicio) || !Number.isSafeInteger(fin) || inicio < 0 || fin <= inicio || fin - inicio > 86_400_000) {
    throw new RangeError('La ventana debe ser pasada y de hasta 24 horas.');
  }
  const formato = new Intl.DateTimeFormat('en-CA', { timeZone: opciones.zona, year: 'numeric', month: '2-digit', day: '2-digit' });
  const fecha = (ms: number) => formato.format(ms);
  const tramos: IntervaloUso[] = [];
  for (const tramo of [...opciones.tramos].sort((a, b) => a.inicio - b.inicio)) {
    if (!Number.isSafeInteger(tramo.inicio) || !Number.isSafeInteger(tramo.fin) || tramo.inicio >= tramo.fin) throw new RangeError('Intervalo inválido.');
    const actual = { inicio: Math.max(inicio, tramo.inicio), fin: Math.min(fin, tramo.fin) };
    if (actual.inicio >= actual.fin) continue;
    const ultimo = tramos.at(-1);
    if (ultimo && actual.inicio <= ultimo.fin) ultimo.fin = Math.max(ultimo.fin, actual.fin);
    else tramos.push(actual);
  }
  const eventos: PendienteUso[] = [];
  let desde = inicio;
  while (desde < fin) {
    let hasta = fin;
    if (fecha(desde) !== fecha(fin - 1)) {
      let bajo = desde; let alto = fin - 1;
      while (alto - bajo > 1) {
        const medio = Math.floor((bajo + alto) / 2);
        if (fecha(medio) === fecha(desde)) bajo = medio; else alto = medio;
      }
      hasta = alto;
    }
    // 32 tramos por evento dejan margen bajo 4 KiB incluso con una zona IANA larga.
    const locales = tramos.filter(t => t.inicio < hasta && t.fin > desde)
      .map(t => ({ inicio: Math.max(desde, t.inicio), fin: Math.min(hasta, t.fin) }));
    let corte = desde;
    for (let indice = 0; indice < Math.max(1, locales.length); indice += 32) {
      const grupo = locales.slice(indice, indice + 32);
      const ultimo = indice + 32 >= locales.length;
      const limite = ultimo ? hasta : grupo.at(-1)!.fin;
      eventos.push({ suscripcion_id: opciones.suscripcionId, evento: {
        version: 1, event_id: opciones.uuid(), recolector_id: opciones.recolectorId, origen: opciones.origen,
        inicio: new Date(corte).toISOString(), fin: new Date(limite).toISOString(),
        duracion_ms: grupo.reduce((total, t) => total + t.fin - t.inicio, 0),
        tramos_actividad: grupo.map(t => ({ inicio: new Date(t.inicio).toISOString(), fin: new Date(t.fin).toISOString() })),
        zona_horaria: opciones.zona, cobertura: grupo.length ? 'parcial' : 'sin_medicion', estado: 'activo',
      } });
      corte = limite;
    }
    desde = hasta;
  }
  return eventos;
}

export interface OpcionesRecolectorUso {
  almacen: { leer(): Promise<string | null>; guardar(valor: string): Promise<void> };
  obtenerSesion(): string | null; suscripcionId: string; origen: OrigenRecolector; uuid(): string;
  ahora?: () => number; enviar?: typeof enviarUsoPendiente; cambiarConsentimiento?: typeof cambiarConsentimientoUso;
}

/** Un propietario por almacén. El host separa almacenes por cuenta+servidor. */
export function crearRecolectorUso(opciones: OpcionesRecolectorUso) {
  const ahora = opciones.ahora ?? Date.now;
  const enviar = opciones.enviar ?? enviarUsoPendiente;
  const cambiar = opciones.cambiarConsentimiento ?? cambiarConsentimientoUso;
  const sesionInicial = opciones.obtenerSesion();
  let cargado = false;
  let estado: EstadoColaUso | null = null;
  let cola: Promise<unknown> = Promise.resolve();
  let bloqueado = false;
  let motivoBloqueo: 'pausa' | 'retiro' | 'detener' | undefined;
  let revisionBloqueo = 0;
  let cancelacion: AbortController | undefined;
  function vigente() {
    if (!sesionInicial || opciones.obtenerSesion() !== sesionInicial) throw new Error('La sesión del recolector cambió.');
  }
  function serial<T>(operacion: () => Promise<T>): Promise<T> {
    const siguiente = cola.then(operacion);
    cola = siguiente.catch(() => {});
    return siguiente;
  }
  async function cargar() {
    vigente();
    if (cargado) return;
    const texto = await opciones.almacen.leer();
    vigente();
    if (texto) {
      const leido = JSON.parse(texto) as EstadoColaUso;
      if (leido.version !== 1 || leido.suscripcionId !== opciones.suscripcionId || leido.origen !== opciones.origen ||
          !Array.isArray(leido.pendientes) || !Number.isSafeInteger(leido.cursor)) throw new Error('Estado de recolector inválido.');
      estado = leido;
    }
    cargado = true;
  }
  async function guardar(nuevo: EstadoColaUso) {
    vigente();
    await opciones.almacen.guardar(JSON.stringify(nuevo));
    vigente();
    estado = nuevo;
  }
  async function remoto(accion: AccionConsentimientoUso, registro: EstadoColaUso) {
    const controlador = new AbortController();
    cancelacion = controlador;
    const limite = setTimeout(() => controlador.abort(), 10_000);
    let abortar: () => void;
    const cancelado = new Promise<never>((_resolver, rechazar) => {
      abortar = () => rechazar(new Error('Solicitud de consentimiento cancelada.'));
      controlador.signal.addEventListener('abort', abortar, { once: true });
    });
    try {
      const respuesta = await Promise.race([cambiar({ suscripcionId: opciones.suscripcionId,
        recolectorId: registro.recolectorId, origen: opciones.origen, accion, signal: controlador.signal }), cancelado]);
      vigente();
      return respuesta;
    } finally { clearTimeout(limite); controlador.signal.removeEventListener('abort', abortar!); cancelacion = undefined; }
  }
  async function confirmarRetiroOPausa() {
    if (!estado?.accionPendiente) return;
    const revision = revisionBloqueo;
    const accion = estado.accionPendiente;
    let sinDestino = false;
    try { await remoto(accion, estado); }
    catch (error) {
      // Un destino eliminado/inaccesible tampoco puede recibir eventos. Mantener
      // la lápida local permite elegir otra suscripción sin reactivar este UUID.
      if (accion === 'revocar' && error instanceof ErrorDeApi && error.status === 404) sinDestino = true;
      else throw error;
    }
    await guardar({ ...estado, accionPendiente: undefined,
      error: sinDestino ? 'Retiro local completado: la suscripción ya no está disponible en el servidor.' : undefined,
      fase: accion === 'revocar' ? 'revocado' : 'pausado' });
    if (accion === 'pausar' && revision === revisionBloqueo && motivoBloqueo === 'pausa') {
      bloqueado = false; motivoBloqueo = undefined;
    }
  }
  return {
    estado: () => serial(async () => { await cargar(); return estado ? JSON.parse(JSON.stringify(estado)) as EstadoColaUso : null; }),
    aceptar: () => {
      const revision = revisionBloqueo;
      return serial(async () => {
        await cargar();
        await confirmarRetiroOPausa();
        if (!estado || estado.fase === 'revocado') {
          await guardar({ version: 1, sesionId: sesionInicial!, suscripcionId: opciones.suscripcionId,
            recolectorId: opciones.uuid(), origen: opciones.origen, fase: 'pendiente', cursor: ahora(),
            zona: 'America/Santiago', desfaseMs: 0, pendientes: [], fallos: 0, siguienteIntento: 0 });
        }
        const actual = estado!;
        if (actual.errorPermanente) throw new Error('El servidor rechazó un evento. Retira la autorización y corrige la configuración antes de volver a capturar.');
        const respuesta = await remoto(actual.fase === 'pausado' ? 'reanudar' : 'aceptar', actual);
        const desfaseMs = Date.parse(respuesta.servidor_ahora) - ahora();
        // Una nueva sesión/pausa no autoriza reconstruir actividad del intervalo sin captura.
        const cursor = actual.fase === 'activo' && actual.sesionId === sesionInicial ? actual.cursor :
          Math.max(ahora(), Date.parse(respuesta.desde!) - desfaseMs);
        await guardar({ ...actual, sesionId: sesionInicial!, fase: 'activo', cursor,
          zona: respuesta.zona_horaria, desfaseMs, error: undefined });
        if (revision === revisionBloqueo) { bloqueado = false; motivoBloqueo = undefined; }
      });
    },
    capturar: (fin: number, tramos: readonly IntervaloUso[]) => serial(async () => {
      await cargar();
      if (!estado || estado.sesionId !== sesionInicial || estado.fase !== 'activo' || bloqueado) throw new Error('Captura sin consentimiento activo.');
      if (fin > ahora()) throw new RangeError('No se puede capturar uso futuro.');
      if (fin <= estado.cursor) return;
      const eventos = construirEventosUso({ suscripcionId: opciones.suscripcionId, recolectorId: estado.recolectorId,
        origen: opciones.origen, inicio: estado.cursor + estado.desfaseMs, fin: fin + estado.desfaseMs,
        zona: estado.zona, uuid: opciones.uuid,
        tramos: tramos.map(t => ({ inicio: t.inicio + estado!.desfaseMs, fin: t.fin + estado!.desfaseMs })) });
      if (estado.pendientes.length + eventos.length > 128) throw new Error('La cola está llena. Sincroniza para continuar; el cursor se conserva.');
      await guardar({ ...estado, cursor: fin, pendientes: [...estado.pendientes, ...eventos] });
    }),
    sincronizar: () => serial(async () => {
      await cargar();
      if (!estado) return;
      try {
        await confirmarRetiroOPausa();
        if (estado.sesionId !== sesionInicial) return;
        if (estado.errorPermanente || estado.fase === 'revocado' || estado.fase === 'revocando' || estado.fase === 'pendiente' || ahora() < estado.siguienteIntento) return;
        while (estado.pendientes.length) {
          vigente();
          if (bloqueado) return;
          const pendiente = estado.pendientes[0];
          cancelacion = new AbortController();
          let recibidoEn: string | undefined;
          await enviar(pendiente, async acuse => { recibidoEn = acuse.recibidoEn; }, { signal: cancelacion.signal });
          vigente();
          if (bloqueado) return;
          if (!recibidoEn) throw new Error('El emisor no confirmó el acuse.');
          await guardar({ ...estado, pendientes: estado.pendientes.slice(1), ultimoEnvio: recibidoEn,
            fallos: 0, siguienteIntento: 0, error: undefined });
        }
      } catch (error) {
        vigente();
        if (bloqueado) return;
        const renovacionTemporal = error instanceof ErrorDeApi && error.status === 401 &&
          (error.sesion?.motivo === 'renovacion_temporal' || error.sesion?.motivo === 'token_obsoleto');
        const permanente = error instanceof ErrorDeApi && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status) && !renovacionTemporal;
        await guardar({ ...estado, fallos: estado.fallos + 1,
          errorPermanente: permanente, fase: permanente && estado.fase === 'activo' ? 'pausado' : estado.fase,
          siguienteIntento: ahora() + Math.min(300_000, 1000 * 2 ** Math.min(estado.fallos, 8)),
          error: (permanente ? 'Rechazo permanente: ' : 'Fallo recuperable: ') + (error instanceof Error ? error.message : 'No se pudo sincronizar.') });
      } finally { cancelacion = undefined; }
    }),
    pausar: () => {
      ++revisionBloqueo;
      motivoBloqueo = 'pausa';
      bloqueado = true; cancelacion?.abort();
      return serial(async () => {
        await cargar();
        if (!estado || estado.fase === 'revocado' || estado.fase === 'revocando') return;
        await guardar({ ...estado, fase: 'pausado', accionPendiente: 'pausar' });
        await confirmarRetiroOPausa();
      });
    },
    revocar: () => {
      ++revisionBloqueo;
      motivoBloqueo = 'retiro';
      bloqueado = true; cancelacion?.abort();
      return serial(async () => {
        await cargar();
        if (!estado || estado.fase === 'revocado') return;
        await guardar({ ...estado, fase: 'revocando', pendientes: [], accionPendiente: 'revocar' });
        await confirmarRetiroOPausa();
      });
    },
    detener: () => { ++revisionBloqueo; motivoBloqueo = 'detener'; bloqueado = true; cancelacion?.abort(); },
  };
}
