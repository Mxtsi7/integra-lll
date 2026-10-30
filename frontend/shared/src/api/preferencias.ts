import { pedir } from './cliente';

/**
 * Las preferencias de aviso que se pueden cambiar (PreferenciaNotificacion de
 * FE-21). Son las de quien consulta: el gateway pone la organización y el
 * usuario, así que no hay id.
 */
export interface PreferenciasEditables {
  por_email: boolean;
  por_push: boolean;
  en_la_app: boolean;
  avisar_proximo_cobro: boolean;
  avisar_fin_prueba: boolean;
  avisar_alza_tarifa: boolean;
  avisar_doble_cobro: boolean;
  avisar_presupuesto_excedido: boolean;
  /** Días antes del cobro en que se avisa (1 a 30). */
  dias_anticipacion: number;
}

/** Las claves de arriba, en el orden del serializer. Solo estas viajan en el PATCH. */
export const CLAVES_PREFERENCIAS: readonly (keyof PreferenciasEditables)[] = [
  'por_email',
  'por_push',
  'en_la_app',
  'avisar_proximo_cobro',
  'avisar_fin_prueba',
  'avisar_alza_tarifa',
  'avisar_doble_cobro',
  'avisar_presupuesto_excedido',
  'dias_anticipacion',
];

/** Un canal de aviso, como lo nombra el backend en `canales_disponibles`. */
export type CanalAviso = 'email' | 'push' | 'in_app';

export interface PreferenciasAlertas extends PreferenciasEditables {
  /** Los canales que el servidor entrega HOY. Uno encendido que no esté acá se guarda pero no llega. */
  canales_disponibles: CanalAviso[];
  canales_elegidos: CanalAviso[];
  actualizado_en: string;
}

/** GET /api/preferencias-alertas/. La primera vez el backend crea las de por omisión. */
export async function getPreferenciasAlertas(): Promise<PreferenciasAlertas> {
  return await pedir('/preferencias-alertas/');
}

/**
 * PATCH /api/preferencias-alertas/ con solo lo que cambió (CH-30). Un valor
 * inválido responde 400 y el backend no guarda nada; la respuesta trae las
 * preferencias completas ya guardadas.
 */
export async function guardarPreferenciasAlertas(
  cambios: Partial<PreferenciasEditables>,
): Promise<PreferenciasAlertas> {
  return await pedir('/preferencias-alertas/', { method: 'PATCH', body: cambios });
}

/** Solo lo que es distinto entre lo guardado y lo editado: lo que viaja en el PATCH. */
export function cambiosDePreferencias(
  guardadas: PreferenciasEditables,
  editadas: PreferenciasEditables,
): Partial<PreferenciasEditables> {
  const cambios: Partial<PreferenciasEditables> = {};
  for (const clave of CLAVES_PREFERENCIAS) {
    if (editadas[clave] !== guardadas[clave]) copiar(cambios, editadas, clave);
  }
  return cambios;
}

function copiar<K extends keyof PreferenciasEditables>(
  destino: Partial<PreferenciasEditables>,
  origen: PreferenciasEditables,
  clave: K,
) {
  destino[clave] = origen[clave];
}

/** Lo editable de una respuesta completa (sin canales_disponibles ni fechas). */
export function preferenciasEditables(p: PreferenciasEditables): PreferenciasEditables {
  const editables = {} as PreferenciasEditables;
  for (const clave of CLAVES_PREFERENCIAS) copiar(editables, p, clave);
  return editables;
}
