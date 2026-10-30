declare module 'expo-secure-store' {
  export interface SecureStoreOptions {
    keychainService?: string;
    keychainAccessible?: number;
    requireAuthentication?: boolean;
    authenticationPrompt?: string;
  }

  export function getItemAsync(key: string, options?: SecureStoreOptions): Promise<string | null>;
  export function setItemAsync(key: string, value: string, options?: SecureStoreOptions): Promise<void>;
  export function deleteItemAsync(key: string, options?: SecureStoreOptions): Promise<void>;
  export function isAvailableAsync(): Promise<boolean>;
  export function __limpiarStoreParaPruebas(): void;
  export function __obtenerStoreParaPruebas(): Map<string, string>;
}
