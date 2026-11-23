// Google Identity Services: la librería oficial de Google para "Iniciar sesión con Google" (S3-AN-07).
// Solo da identidad (quién es la persona); no pide permiso para leer Gmail.
// Docs: https://developers.google.com/identity/gsi/web/reference/js-reference

const URL_GOOGLE = 'https://accounts.google.com/gsi/client';

export interface RespuestaCredencialGoogle {
  /** ID token (JWT) firmado por Google. Solo el backend lo valida. */
  credential: string;
}

export interface GoogleId {
  initialize(config: {
    client_id: string;
    nonce: string;
    callback: (respuesta: RespuestaCredencialGoogle) => void;
  }): void;
  renderButton(elemento: HTMLElement, opciones: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleId } };
  }
}

let cargando: Promise<GoogleId> | null = null;

/**
 * Carga el script de Google una sola vez y devuelve su API. Si no se puede
 * cargar (sin red, bloqueado por una extensión) falla con un Error: el
 * inicio con Google queda sin ofrecerse y el correo con contraseña sigue
 * funcionando.
 */
export function cargarGoogleIdentity(): Promise<GoogleId> {
  const listo = window.google?.accounts?.id;
  if (listo) return Promise.resolve(listo);
  if (cargando) return cargando;

  cargando = new Promise<GoogleId>((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = URL_GOOGLE;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const api = window.google?.accounts?.id;
      if (api) resolver(api);
      else rechazar(new Error('Google no respondió.'));
    };
    script.onerror = () => rechazar(new Error('No se pudo cargar Google.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // Para poder reintentar después de un fallo.
    cargando = null;
    document.querySelector(`script[src="${URL_GOOGLE}"]`)?.remove();
    throw error;
  });
  return cargando;
}
