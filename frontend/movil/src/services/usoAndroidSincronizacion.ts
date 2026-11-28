import { randomUUID } from 'expo-crypto';
import { crearRecolectorUso, obtenerAccessToken, obtenerAuthApiUrl, sesionDelToken, type EstadoColaUso } from '@ojoalgasto/shared';
import { controlAsociacionPaquetes } from './usoAndroidAsociacion';
import { crearControlUsoAndroid } from './usoAndroid';
import { usoAndroidNativo } from './usoAndroidNativo';
import { CLAVES_SEGURAS, guardarDatoSeguro, leerDatoSeguro } from './storageSeguro';
import { crearAlmacenUsoSegmentado } from './almacenUsoSegmentado';

interface SeleccionUso { sesionId: string; urlBase: string; paquete: string; suscripcionId: string; cola: string | null }
const almacen = crearAlmacenUsoSegmentado({ leer: leerDatoSeguro, guardar: guardarDatoSeguro, identidad: sesionUsoAndroid }, CLAVES_SEGURAS.COLA_USO);
export function sesionUsoAndroid(): string | null {
  const token = obtenerAccessToken();
  return token ? sesionDelToken(token) : null;
}
let seleccion: SeleccionUso | null = null;
let control: ReturnType<typeof crearRecolectorUso> | null = null;
let sesionControl: string | null = null;
let cargando: Promise<void> | null = null;
let enCiclo = false;
let revision = 0;

async function restaurar() {
  const sesion = sesionUsoAndroid();
  if (!sesion) { control?.detener(); throw new Error('Inicia sesión para sincronizar.'); }
  if (sesionControl === sesion) return;
  if (cargando) { await cargando; return restaurar(); }
  control?.detener(); control = null; seleccion = null;
  cargando = (async () => {
    const texto = await almacen.leer();
    if (sesion !== sesionUsoAndroid()) throw new Error('La sesión cambió.');
    const anterior = texto ? JSON.parse(texto) as SeleccionUso : null;
    seleccion = anterior?.sesionId === sesion && anterior.urlBase === obtenerAuthApiUrl() ? anterior : null;
    sesionControl = sesion;
    if (seleccion) crearControl(seleccion);
  })();
  try { await cargando; } finally { cargando = null; }
}

function crearControl(datos: SeleccionUso) {
  control = crearRecolectorUso({ obtenerSesion: sesionUsoAndroid, suscripcionId: datos.suscripcionId,
    origen: 'android', uuid: randomUUID,
    almacen: {
      leer: async () => datos.cola,
      guardar: async cola => {
        if (datos.sesionId !== sesionUsoAndroid() || datos.urlBase !== obtenerAuthApiUrl()) throw new Error('La sesión o el servidor cambió.');
        const siguiente = { ...datos, cola };
        await almacen.guardar(JSON.stringify(siguiente));
        datos.cola = cola;
      },
    } });
}

export async function estadoUsoAndroid(): Promise<{ seleccion: SeleccionUso | null; estado: EstadoColaUso | null }> {
  await restaurar();
  return { seleccion, estado: await control?.estado() ?? null };
}

export async function aceptarUsoAndroid(paquete: string) {
  const actual = revision;
  const sesion = sesionUsoAndroid();
  const vigente = () => {
    if (!sesion || sesionUsoAndroid() !== sesion || revision !== actual) throw new Error('La autorización fue cancelada.');
  };
  await restaurar();
  vigente();
  const asociaciones = await controlAsociacionPaquetes.listar();
  vigente();
  const asociacion = asociaciones.find(a => a.paquete === paquete);
  if (!asociacion) throw new Error('Primero asocia ese paquete con una suscripción en Configuración.');
  if (!await usoAndroidNativo?.tienePermiso() || !usoAndroidNativo?.leerTramos) throw new Error('Concede el permiso de acceso al uso.');
  vigente();
  if (seleccion && (seleccion.paquete !== paquete || seleccion.suscripcionId !== asociacion.suscripcionId)) {
    const anterior = await control!.estado();
    vigente();
    if (anterior?.fase !== 'revocado') throw new Error('Retira la autorización anterior antes de cambiar la asociación.');
    control = null;
  }
  if (!control) {
    const nueva: SeleccionUso = { sesionId: sesionUsoAndroid()!, urlBase: obtenerAuthApiUrl(), paquete, suscripcionId: asociacion.suscripcionId, cola: null };
    await almacen.guardar(JSON.stringify(nueva));
    vigente();
    seleccion = nueva; crearControl(nueva);
  }
  await control!.aceptar();
}

export function pausarUsoAndroid() { ++revision; return restaurar().then(() => control?.pausar()); }
export function revocarUsoAndroid() {
  ++revision; control?.detener(); // Detener antes de cualquier lectura de almacenamiento/red.
  return restaurar().then(() => control?.revocar());
}
export function detenerUsoAndroid() { ++revision; control?.detener(); control = null; seleccion = null; sesionControl = null; }

/** UsageEvents se consulta solo en primer plano; el cursor permite retomar tras reiniciar. */
export async function cicloUsoAndroid() {
  if (enCiclo || !sesionUsoAndroid()) return;
  enCiclo = true;
  const actual = revision;
  try {
    await restaurar();
    const recolector = control;
    const datos = seleccion;
    if (!recolector || !datos) return;
    await recolector.sincronizar();
    const estado = await recolector.estado();
    if (!estado || estado.fase !== 'activo' || actual !== revision) return;
    const asociaciones = await controlAsociacionPaquetes.listar();
    if (!asociaciones.some(a => a.paquete === datos.paquete && a.suscripcionId === datos.suscripcionId)) {
      await recolector.pausar(); throw new Error('La asociación cambió. La captura quedó pausada.');
    }
    const fin = Math.min(Date.now(), estado.cursor + 86_400_000);
    if (fin <= estado.cursor) return;
    const alcance = { id: estado.recolectorId, desdeMs: estado.cursor, paquetes: [datos.paquete] };
    const vigente = () => actual === revision && datos.sesionId === sesionUsoAndroid() && control === recolector;
    const lector = crearControlUsoAndroid(usoAndroidNativo, sesionUsoAndroid, vigente, () => vigente() ? alcance : null);
    const lectura = await lector.leerTramos(estado.cursor, fin);
    if (!vigente()) return;
    if (lectura.estado !== 'disponible') {
      await recolector.pausar();
      throw new Error('Captura pausada: comprueba el permiso de Android y vuelve a autorizar.');
    }
    await recolector.capturar(fin, lectura.tramos.map(t => ({ inicio: t.inicioMs, fin: t.finMs })));
    await recolector.sincronizar();
  } finally { enCiclo = false; }
}
