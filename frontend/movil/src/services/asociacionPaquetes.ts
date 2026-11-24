export interface AsociacionPaquete {
  suscripcionId: string;
  paquete: string;
}

interface AlmacenAsociaciones {
  leer(): Promise<string | null>;
  guardar(valor: string): Promise<void>;
}

interface DependenciasAsociacion {
  obtenerSesion(): string | null;
  obtenerSuscripcion(id: string): Promise<{ id: string }>;
  almacen: AlmacenAsociaciones;
}

const PATRON_PAQUETE_ANDROID = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+$/;

export function validarPaqueteAndroid(paquete: string): string {
  const paqueteNormalizado = paquete.trim();
  if (paqueteNormalizado.length > 255 || !PATRON_PAQUETE_ANDROID.test(paqueteNormalizado)) {
    throw new RangeError('Escribe un nombre de paquete Android válido, por ejemplo com.ejemplo.app.');
  }
  return paqueteNormalizado;
}

function parsearAsociaciones(valor: string | null): Record<string, AsociacionPaquete[]> {
  if (!valor) return {};
  const asociacionesDesconocidas: unknown = JSON.parse(valor);
  if (typeof asociacionesDesconocidas !== 'object' || asociacionesDesconocidas === null || Array.isArray(asociacionesDesconocidas)) {
    throw new Error('El almacenamiento de asociaciones tiene un formato incompatible.');
  }
  for (const asociacionesSesion of Object.values(asociacionesDesconocidas)) {
    if (!Array.isArray(asociacionesSesion) || asociacionesSesion.some((asociacion) =>
      typeof asociacion !== 'object' || asociacion === null
      || typeof asociacion.suscripcionId !== 'string'
      || typeof asociacion.paquete !== 'string'
      || !PATRON_PAQUETE_ANDROID.test(asociacion.paquete))) {
      throw new Error('El almacenamiento de asociaciones contiene datos incompatibles.');
    }
  }
  return asociacionesDesconocidas as Record<string, AsociacionPaquete[]>;
}

export function crearControlAsociacionPaquetes(dependencias: DependenciasAsociacion) {
  let colaMutaciones: Promise<void> = Promise.resolve();

  function exigirMismaSesion(sesion: string, momento: string): void {
    if (dependencias.obtenerSesion() !== sesion) {
      throw new Error(`La sesión cambió ${momento}.`);
    }
  }

  function serializarMutacion(sesion: string, operacion: () => Promise<void>): Promise<void> {
    const resultado = colaMutaciones.then(() => {
      exigirMismaSesion(sesion, 'mientras la operación esperaba');
      return operacion();
    });
    colaMutaciones = resultado.then(() => undefined, () => undefined);
    return resultado;
  }

  async function leerAsociacionesPorSesion(): Promise<Record<string, AsociacionPaquete[]>> {
    return parsearAsociaciones(await dependencias.almacen.leer());
  }

  return {
    async listar(): Promise<AsociacionPaquete[]> {
      const sesion = dependencias.obtenerSesion();
      if (!sesion) return [];
      const asociaciones = await leerAsociacionesPorSesion();
      if (dependencias.obtenerSesion() !== sesion) return [];
      return [...(asociaciones[sesion] ?? [])];
    },

    async asociar(suscripcionId: string, paqueteRecibido: string): Promise<void> {
      const sesion = dependencias.obtenerSesion();
      if (!sesion) throw new Error('Inicia sesión para asociar un paquete Android.');
      return serializarMutacion(sesion, async () => {
        const paquete = validarPaqueteAndroid(paqueteRecibido);
        const suscripcionValidada = await dependencias.obtenerSuscripcion(suscripcionId);
        exigirMismaSesion(sesion, 'durante la validación');
        if (suscripcionValidada.id !== suscripcionId) throw new Error('La suscripción validada no coincide.');

        const asociacionesPorSesion = await leerAsociacionesPorSesion();
        exigirMismaSesion(sesion, 'antes de escribir');
        const asociacionesSesion = asociacionesPorSesion[sesion] ?? [];
        const asociacionExistente = asociacionesSesion.find((asociacion) => asociacion.paquete === paquete);
        if (asociacionExistente && asociacionExistente.suscripcionId !== suscripcionId) {
          throw new Error('Este paquete ya está asociado a otra suscripción.');
        }

        asociacionesPorSesion[sesion] = [
          ...asociacionesSesion.filter((asociacion) => asociacion.paquete !== paquete),
          { suscripcionId, paquete },
        ];
        await dependencias.almacen.guardar(JSON.stringify(asociacionesPorSesion));
        exigirMismaSesion(sesion, 'durante la escritura');
      });
    },

    async quitar(paqueteRecibido: string): Promise<void> {
      const sesion = dependencias.obtenerSesion();
      if (!sesion) throw new Error('Inicia sesión para administrar asociaciones.');
      return serializarMutacion(sesion, async () => {
        const paquete = validarPaqueteAndroid(paqueteRecibido);
        const asociacionesPorSesion = await leerAsociacionesPorSesion();
        exigirMismaSesion(sesion, 'antes de escribir');
        asociacionesPorSesion[sesion] = (asociacionesPorSesion[sesion] ?? [])
          .filter((asociacion) => asociacion.paquete !== paquete);
        await dependencias.almacen.guardar(JSON.stringify(asociacionesPorSesion));
        exigirMismaSesion(sesion, 'durante la escritura');
      });
    },
  };
}
