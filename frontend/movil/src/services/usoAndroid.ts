export interface TramoUsoAndroid { paquete: string; inicioMs: number; finMs: number }
export interface AlcanceUsoAndroid {
  /** Cambia en cada aceptación o edición, incluso al volver a la misma selección. */
  readonly id: string;
  readonly desdeMs: number;
  readonly paquetes: readonly string[];
}
const MAX_VENTANA_TRAMOS_MS = 86_400_000;

export interface EstadisticaAndroid { paquete: string; duracionMs: number }
export interface UsoAndroidNativo {
  tienePermiso(): Promise<boolean>;
  abrirAjustes(): Promise<void>;
  leerTramos?(inicioMs: number, finMs: number, paquetes: string[], consentimientoVigente: boolean): Promise<TramoUsoAndroid[]>;
  leerEstadisticas(inicioMs: number, finMs: number, consentimientoVigente: boolean): Promise<EstadisticaAndroid[]>;
}
export type EstadoPermisoUsoAndroid = 'cargando' | 'no_disponible' | 'requerido' | 'concedido' | 'error';
type Bloqueo = 'sin_sesion' | 'sesion_cambiada' | 'sin_consentimiento' | 'sin_permiso' | 'revocado' | 'no_disponible';
type ResultadoLectura<T> = { estado: Bloqueo } | { estado: 'disponible'; datos: T };
export type ResultadoTramosAndroid = { estado: Bloqueo } | { estado: 'disponible'; tramos: TramoUsoAndroid[] };
export type ResultadoUsoAndroid = { estado: Bloqueo } | { estado: 'disponible'; estadisticas: EstadisticaAndroid[] };

export function crearControlPermisoUsoAndroid(nativo: UsoAndroidNativo | null) {
  return {
    async verificar(): Promise<EstadoPermisoUsoAndroid> {
      if (!nativo) return 'no_disponible';
      try {
        return await nativo.tienePermiso() ? 'concedido' : 'requerido';
      } catch {
        return 'error';
      }
    },
    async abrirAjustes(): Promise<boolean> {
      if (!nativo) return false;
      try {
        await nativo.abrirAjustes();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Consentimiento procede del control vigente del host; nunca del permiso SO. */
export function crearControlUsoAndroid(
  nativo: UsoAndroidNativo | null,
  obtenerSesion: () => string | null,
  tieneConsentimientoVigente: () => boolean = () => false,
  obtenerAlcanceVigente: () => AlcanceUsoAndroid | null = () => null,
) {
  async function leerConPermiso<T>(
    consultar: (modulo: UsoAndroidNativo) => Promise<T>,
    conservaAlcance: () => boolean = () => true,
  ): Promise<ResultadoLectura<T>> {
    const sesion = obtenerSesion();
    if (!sesion) return { estado: 'sin_sesion' };
    if (!tieneConsentimientoVigente() || !conservaAlcance()) return { estado: 'sin_consentimiento' };
    if (!nativo) return { estado: 'no_disponible' };
    const bloqueo = (): Bloqueo | null => obtenerSesion() !== sesion ? 'sesion_cambiada'
      : !tieneConsentimientoVigente() || !conservaAlcance() ? 'sin_consentimiento' : null;
    const permisoInicial = await nativo.tienePermiso();
    const bloqueoInicial = bloqueo();
    if (bloqueoInicial) return { estado: bloqueoInicial };
    if (!permisoInicial) return { estado: 'sin_permiso' };
    let datos: T;
    try {
      datos = await consultar(nativo);
    } catch (error) {
      const bloqueoLectura = bloqueo();
      if (bloqueoLectura) return { estado: bloqueoLectura };
      // El puente puede rechazar si Android revoca el permiso durante la consulta.
      const permisoTrasError = await nativo.tienePermiso();
      const bloqueoTrasError = bloqueo();
      if (bloqueoTrasError) return { estado: bloqueoTrasError };
      if (!permisoTrasError) return { estado: 'revocado' };
      throw error;
    }
    const permisoFinal = await nativo.tienePermiso();
    const bloqueoFinal = bloqueo();
    if (bloqueoFinal) return { estado: bloqueoFinal };
    if (!permisoFinal) return { estado: 'revocado' };
    return { estado: 'disponible', datos };
  }

  function validarVentana(inicioMs: number, finMs: number): void {
    if (!Number.isSafeInteger(inicioMs) || !Number.isSafeInteger(finMs) || inicioMs < 0 || inicioMs >= finMs) {
      throw new RangeError('Ventana de estadísticas inválida en milisegundos');
    }
  }

  return {
    async leer(inicioMs: number, finMs: number): Promise<ResultadoUsoAndroid> {
      validarVentana(inicioMs, finMs);
      const resultado = await leerConPermiso(modulo => modulo.leerEstadisticas(inicioMs, finMs, true));
      return resultado.estado === 'disponible'
        ? { estado: 'disponible', estadisticas: resultado.datos } : resultado;
    },
    async leerTramos(inicioMs: number, finMs: number): Promise<ResultadoTramosAndroid> {
      validarVentana(inicioMs, finMs);
      if (finMs > Date.now() || finMs - inicioMs > MAX_VENTANA_TRAMOS_MS) {
        throw new RangeError('La lectura de tramos requiere una ventana pasada de hasta 24 horas');
      }
      const alcance = obtenerAlcanceVigente();
      if (!alcance?.id || !Number.isSafeInteger(alcance.desdeMs) || alcance.desdeMs < 0) {
        return { estado: 'sin_consentimiento' };
      }
      const leerTramosNativos = nativo?.leerTramos?.bind(nativo);
      if (!leerTramosNativos) return { estado: 'no_disponible' };
      const inicioAutorizado = Math.max(inicioMs, alcance.desdeMs);
      const paquetes = new Set(alcance.paquetes.filter(paquete => paquete.trim()));
      const resultado = await leerConPermiso(
        () => inicioAutorizado < finMs && paquetes.size
          ? leerTramosNativos(inicioAutorizado, finMs, [...paquetes], true)
          : Promise.resolve([]),
        () => obtenerAlcanceVigente()?.id === alcance.id,
      );
      if (resultado.estado !== 'disponible') return resultado;
      return {
        estado: 'disponible',
        tramos: resultado.datos.filter(tramo =>
          paquetes.has(tramo.paquete) && Number.isSafeInteger(tramo.inicioMs) && Number.isSafeInteger(tramo.finMs)
          && tramo.inicioMs >= inicioAutorizado && tramo.inicioMs < tramo.finMs && tramo.finMs <= finMs),
      };
    },
  };
}
