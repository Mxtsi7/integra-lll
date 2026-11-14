import { readFileSync } from 'node:fs';

import { ProcesadorUso } from '../../src/aplicacion/procesador-uso';
import type {
  RepositorioUso,
  ResultadoRegistroUso,
} from '../../src/aplicacion/repositorio-uso';
import { ErrorValidacionUso } from '../../src/dominio/errores';
import type { EventoUsoNormalizado } from '../../src/dominio/uso-recolectores.dto';
import { validarYNormalizar } from '../../src/dominio/validacion';

/**
 * Puente para la prueba cruzada Python → TypeScript.
 *
 * La prueba de `services/subscriptions` construye el sobre real con
 * `crear_sobre_uso` y escribe ese JSON. Este proceso lo pasa por el mismo
 * validador y procesador que usa el consumidor. Si Python emitiera más de 3
 * dígitos fraccionarios, aquí se rechazaría con `ErrorValidacionUso`.
 *
 * Uso: node node_modules/tsx/dist/cli.mjs tests/cruzado/validar-sobre-python.ts sobre.json
 */

class RepositorioEnMemoria implements RepositorioUso {
  readonly recibidos: EventoUsoNormalizado[] = [];

  async registrar(evento: EventoUsoNormalizado): Promise<ResultadoRegistroUso> {
    this.recibidos.push(evento);
    return 'aplicado';
  }
}

async function principal(): Promise<void> {
  const ruta = process.argv[2];
  if (!ruta) {
    throw new Error('falta la ruta del sobre JSON');
  }

  const sobre: unknown = JSON.parse(readFileSync(ruta, 'utf8'));
  const normalizado = validarYNormalizar(sobre);
  const repositorio = new RepositorioEnMemoria();
  const resultado = await new ProcesadorUso(repositorio).procesar(sobre);

  process.stdout.write(
    JSON.stringify({
      ok: true,
      resultado,
      ocurridoEn: normalizado.ocurridoEn.toISOString(),
      fechaLocal: normalizado.fechaLocal,
      eventId: normalizado.eventId,
      llamadasAlRepositorio: repositorio.recibidos.length,
    }),
  );
}

principal().catch((error: unknown) => {
  const esValidacion = error instanceof ErrorValidacionUso;
  process.stdout.write(
    JSON.stringify({
      ok: false,
      nombre: error instanceof Error ? error.name : 'Error',
      mensaje: error instanceof Error ? error.message : String(error),
      ...(esValidacion ? { codigo: error.codigo } : {}),
    }),
  );
  process.exitCode = 2;
});
