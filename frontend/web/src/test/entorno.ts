/**
 * Compatibilidad entre jsdom y el `Request` de Node.
 *
 * React Router 7 crea un `Request` para cada navegación con el `AbortSignal`
 * del entorno. En Vitest con jsdom, ese signal pertenece a jsdom, pero el
 * `Request` global es el de undici (Node 24) y exige un `AbortSignal` nativo:
 *
 *   TypeError: RequestInit: Expected signal ("AbortSignal {}") to be an
 *   instance of AbortSignal.
 *
 * La navegación falla y el árbol de React queda vacío. En los tests no
 * dependemos de cancelar peticiones, así que se omite el signal al construir
 * el Request; el resto del contrato queda igual.
 */
const RequestNativo = globalThis.Request;

if (typeof window !== "undefined" && typeof RequestNativo === "function") {
  class RequestCompatible extends RequestNativo {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init && init.signal) {
        const { signal: _signalDeJsdom, ...resto } = init;
        super(input, resto);
      } else {
        super(input, init);
      }
    }
  }

  globalThis.Request = RequestCompatible as typeof Request;
}

export {};
