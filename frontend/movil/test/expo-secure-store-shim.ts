// Doble de pruebas de expo-secure-store. Guarda en memoria y expone la misma
// API asíncrona que usa src/storage/sesionSegura.ts.
const almacen = new Map<string, string>();

export async function getItemAsync(clave: string): Promise<string | null> {
  return almacen.get(clave) ?? null;
}

export async function setItemAsync(clave: string, valor: string): Promise<void> {
  almacen.set(clave, valor);
}

export async function deleteItemAsync(clave: string): Promise<void> {
  almacen.delete(clave);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';

export function __limpiar(): void {
  almacen.clear();
}
