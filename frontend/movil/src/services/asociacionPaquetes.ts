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

function validarPaqueteAndroid(paquete: string): string {
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

  function serializarMutacion<T>(operacion: () => Promise<T>): Promise<T> {
    const resultado = colaMutaciones.then(operacion);
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

    asociar(suscripcionId: string, paqueteRecibido: string): Promise<void> {
      return serializarMutacion(async () => {
      const paquete = validarPaqueteAndroid(paqueteRecibido);
      const sesion = dependencias.obtenerSesion();
      if (!sesion) throw new Error('Inicia sesión para asociar un paquete Android.');
      const suscripcionValidada = await dependencias.obtenerSuscripcion(suscripcionId);
      if (suscripcionValidada.id !== suscripcionId) throw new Error('La suscripción validada no coincide.');
      if (dependencias.obtenerSesion() !== sesion) throw new Error('La sesión cambió durante la validación.');

      const asociacionesPorSesion = await leerAsociacionesPorSesion();
      if (dependencias.obtenerSesion() !== sesion) throw new Error('La sesión cambió durante la validación.');
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
      if (dependencias.obtenerSesion() !== sesion) throw new Error('La sesión cambió durante la escritura.');
      });
    },

    quitar(paqueteRecibido: string): Promise<void> {
      return serializarMutacion(async () => {
      const paquete = validarPaqueteAndroid(paqueteRecibido);
      const sesion = dependencias.obtenerSesion();
      if (!sesion) throw new Error('Inicia sesión para administrar asociaciones.');
      const asociacionesPorSesion = await leerAsociacionesPorSesion();
      if (dependencias.obtenerSesion() !== sesion) throw new Error('La sesión cambió durante la validación.');
      asociacionesPorSesion[sesion] = (asociacionesPorSesion[sesion] ?? [])
        .filter((asociacion) => asociacion.paquete !== paquete);
      await dependencias.almacen.guardar(JSON.stringify(asociacionesPorSesion));
      if (dependencias.obtenerSesion() !== sesion) throw new Error('La sesión cambió durante la escritura.');
      });
    },
  };
}
