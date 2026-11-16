import type {
  RepositorioSuscripcion,
  ResultadoProyeccionSuscripcion,
} from './repositorio-suscripcion';
import type { EventoSuscripcionEstadoNormalizado } from '../dominio/suscripcion-estado.dto';
import { validarYNormalizarSuscripcion } from '../dominio/validacion-suscripcion';

/**
 * Valida el evento antes de tocar la base. Un cuerpo inválido se rechaza sin
 * reintento; la idempotencia y el orden temporal los decide el repositorio.
 */
export class ProcesadorSuscripcion {
  constructor(private readonly repositorio: RepositorioSuscripcion) {}

  async procesar(sobre: unknown): Promise<ResultadoProyeccionSuscripcion> {
    const evento: EventoSuscripcionEstadoNormalizado =
      validarYNormalizarSuscripcion(sobre);
    return this.repositorio.registrar(evento);
  }
}
