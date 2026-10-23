/** Las dos vistas del calendario (CH-17 y CH-21). Las usan App.tsx y los enlaces entre vistas. */
export const RUTA_CALENDARIO = '/calendario';
export const RUTA_AGENDA = '/calendario/agenda';

/** Enlace a una vista conservando el mes que se está mirando. */
export function rutaConMes(ruta: string, mes: string): string {
  return `${ruta}?${new URLSearchParams({ mes })}`;
}
