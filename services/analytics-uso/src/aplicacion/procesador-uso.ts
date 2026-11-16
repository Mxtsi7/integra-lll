import type { RepositorioUso, ResultadoRegistroUso } from './repositorio-uso';
import { validarYNormalizar } from '../dominio/validacion';
import type { EventoUsoNormalizado } from '../dominio/uso-recolectores.dto';

/**
 * S3-VI-09/S3-VI-11: validar antes de tocar la base y delegar el efecto.
 *
 * Un mensaje inválido nunca llega al repositorio; el consumidor lo rechaza sin
 * reintento. Un duplicado lo decide el repositorio comparando la huella.
 */
export class ProcesadorUso {
  constructor(private readonly repositorio: RepositorioUso) {}

  async procesar(sobre: unknown): Promise<ResultadoRegistroUso> {
    const evento: EventoUsoNormalizado = validarYNormalizar(sobre);
    return this.repositorio.registrar(evento);
  }
}
