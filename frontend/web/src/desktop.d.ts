export {};
declare global {
  interface Window {
    readonly ojoDesktop?: { readonly apiUrl: string };
  }
}
