// Test shim for expo-secure-store in vitest / jsdom environment
const store = new Map<string, string>();

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, String(value));
}

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

export async function isAvailableAsync(): Promise<boolean> {
  return true;
}

export function __limpiarStoreParaPruebas(): void {
  store.clear();
}

export function __obtenerStoreParaPruebas(): Map<string, string> {
  return store;
}
