import { getSuscripcion, obtenerAccessToken, sesionDelToken } from '@ojoalgasto/shared';
import { CLAVES_SEGURAS, guardarDatoSeguro, leerDatoSeguro } from './storageSeguro';
import { crearControlAsociacionPaquetes } from './asociacionPaquetes';

export const controlAsociacionPaquetes = crearControlAsociacionPaquetes({
  obtenerSesion: () => {
    const token = obtenerAccessToken();
    return token ? sesionDelToken(token) : null;
  },
  obtenerSuscripcion: (id) => getSuscripcion(id),
  almacen: {
    leer: () => leerDatoSeguro(CLAVES_SEGURAS.ASOCIACIONES_PAQUETES_USO),
    guardar: (valor) => guardarDatoSeguro(CLAVES_SEGURAS.ASOCIACIONES_PAQUETES_USO, valor),
  },
});
