export interface EstadisticaAndroid { paquete: string; duracionMs: number }
export interface UsoAndroidNativo {
  tienePermiso(): Promise<boolean>;
  abrirAjustes(): Promise<void>;
  leerEstadisticas(inicioMs: number, finMs: number, consentimientoVigente: boolean): Promise<EstadisticaAndroid[]>;
}
export type EstadoPermisoUsoAndroid = 'cargando' | 'no_disponible' | 'requerido' | 'concedido' | 'error';
type Bloqueo = 'sin_sesion' | 'sesion_cambiada' | 'sin_consentimiento' | 'sin_permiso' | 'revocado' | 'no_disponible';
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
) {
  return {
    async leer(inicioMs: number, finMs: number): Promise<ResultadoUsoAndroid> {
      if (!Number.isSafeInteger(inicioMs) || !Number.isSafeInteger(finMs) || inicioMs < 0 || inicioMs >= finMs) {
        throw new RangeError('Ventana de estadísticas inválida en milisegundos');
      }
      const sesion = obtenerSesion();
      if (!sesion) return { estado: 'sin_sesion' };
      if (!tieneConsentimientoVigente()) return { estado: 'sin_consentimiento' };
      if (!nativo) return { estado: 'no_disponible' };
      const bloqueo = (): Bloqueo | null => obtenerSesion() !== sesion ? 'sesion_cambiada'
        : !tieneConsentimientoVigente() ? 'sin_consentimiento' : null;
      const permisoInicial = await nativo.tienePermiso();
      const bloqueoInicial = bloqueo();
      if (bloqueoInicial) return { estado: bloqueoInicial };
      if (!permisoInicial) return { estado: 'sin_permiso' };
      const estadisticas = await nativo.leerEstadisticas(inicioMs, finMs, true);
      const permisoFinal = await nativo.tienePermiso();
      const bloqueoFinal = bloqueo();
      if (bloqueoFinal) return { estado: bloqueoFinal };
      if (!permisoFinal) return { estado: 'revocado' };
      return { estado: 'disponible', estadisticas };
    },
  };
}
