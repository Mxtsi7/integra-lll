import { ErrorConfiguracion } from '../dominio/errores';

export interface Config {
  readonly databaseUrl: string;
  readonly rabbitUrl: string;
  readonly exchangeUso: string;
  readonly exchangeDlx: string;
  readonly colaUso: string;
  readonly colaFallos: string;
  readonly routingKeyUso: string;
  readonly prefetch: number;
  readonly maxReintentos: number;
  readonly logLevel: string;
}

function requerido(env: NodeJS.ProcessEnv, nombre: string): string {
  const valor = env[nombre]?.trim();
  if (!valor) {
    throw new ErrorConfiguracion(`falta la variable de entorno ${nombre}`);
  }
  return valor;
}

function enteroPositivo(
  env: NodeJS.ProcessEnv,
  nombre: string,
  porDefecto: number,
): number {
  const crudo = env[nombre]?.trim();
  if (!crudo) return porDefecto;
  const valor = Number(crudo);
  if (!Number.isInteger(valor) || valor <= 0) {
    throw new ErrorConfiguracion(`${nombre} debe ser un entero positivo: ${crudo}`);
  }
  return valor;
}

/**
 * Configuración explícita del worker y del publicador.
 *
 * `DATABASE_URL` y `RABBITMQ_URL` son obligatorias: no se inventan credenciales
 * locales. El resto tiene valores alineados con el contrato y el compose.
 */
export function cargarConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: requerido(env, 'DATABASE_URL'),
    rabbitUrl: requerido(env, 'RABBITMQ_URL'),
    exchangeUso: env.EXCHANGE_USO?.trim() || 'uso.eventos',
    exchangeDlx: env.EXCHANGE_DLX?.trim() || 'uso.eventos.dlx',
    colaUso: env.COLA_USO?.trim() || 'analytics.uso.cola',
    colaFallos: env.COLA_FALLOS?.trim() || 'analytics.uso.fallos',
    routingKeyUso: env.ROUTING_KEY_USO?.trim() || 'uso.registrado',
    prefetch: enteroPositivo(env, 'PREFETCH', 20),
    maxReintentos: enteroPositivo(env, 'MAX_REINTENTOS', 5),
    logLevel: env.LOG_LEVEL?.trim() || 'info',
  };
}
