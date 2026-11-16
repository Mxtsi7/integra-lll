export type NivelLog = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(mensaje: string, meta?: Record<string, unknown>): void;
  info(mensaje: string, meta?: Record<string, unknown>): void;
  warn(mensaje: string, meta?: Record<string, unknown>): void;
  error(mensaje: string, meta?: Record<string, unknown>): void;
}

const ORDEN: Record<NivelLog, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function normalizarNivel(valor: string | undefined): NivelLog {
  if (valor === 'debug' || valor === 'info' || valor === 'warn' || valor === 'error') {
    return valor;
  }
  return 'info';
}

/**
 * Logs JSON de una línea. No se registra el cuerpo del evento ni credenciales:
 * solo IDs, tipo y motivo, como pide el contrato de transporte.
 */
export function crearLogger(nivel: string | undefined = process.env.LOG_LEVEL): Logger {
  const minimo = ORDEN[normalizarNivel(nivel)];

  const emitir = (nivelEvento: NivelLog, mensaje: string, meta?: Record<string, unknown>) => {
    if (ORDEN[nivelEvento] < minimo) return;
    const salida = {
      ts: new Date().toISOString(),
      nivel: nivelEvento,
      mensaje,
      ...meta,
    };
    const linea = JSON.stringify(salida);
    if (nivelEvento === 'error') {
      console.error(linea);
    } else if (nivelEvento === 'warn') {
      console.warn(linea);
    } else {
      console.log(linea);
    }
  };

  return {
    debug: (mensaje, meta) => emitir('debug', mensaje, meta),
    info: (mensaje, meta) => emitir('info', mensaje, meta),
    warn: (mensaje, meta) => emitir('warn', mensaje, meta),
    error: (mensaje, meta) => emitir('error', mensaje, meta),
  };
}

export function describirError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const codigo = (error as unknown as { code?: unknown }).code;
    return {
      error: error.name,
      mensaje: error.message,
      ...(typeof codigo === 'string' ? { codigo } : {}),
    };
  }
  return { error: String(error) };
}
