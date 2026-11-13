/** Shim de Vitest: los módulos nativos se inyectan en pruebas y Expo real no corre en jsdom. */
export function requireOptionalNativeModule<T>(_nombreModulo: string): T | null {
  return null;
}
