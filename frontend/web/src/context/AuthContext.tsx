import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import { configurarManejador401, ErrorDeApi, getUsuarioActual, guardarTokens, haySesionValida, logout, obtenerAccessToken, revocarSesion, type Usuario} from "@ojoalgasto/shared";
import { useToast } from "./ToastContext";

// Las pantallas nunca leen localStorage: preguntan acá. Los tokens siguen
// viviendo en shared/auth.ts (un solo lugar conoce las claves); este
// contexto solo guarda en memoria *qué sabemos* de la sesión actual.
export type EstadoSesion =
  // Hay un token vigente y estamos preguntando a /usuarios/me/ quién es.
  // Mientras tanto las rutas muestran un spinner en vez de la página o el
  // login, para no "parpadear" al recargar.
  | { tipo: "verificando" }
  | { tipo: "anonimo" }
  // `usuario` es null si el token es válido pero /usuarios/me/ no respondió
  // por algo que no es culpa de la sesión (servidor caído, 500…).
  | { tipo: "autenticado"; usuario: Usuario | null };

type Tokens = { access_token: string; refresh_token: string };

type ApiAuth = {
  estado: EstadoSesion;
  usuario: Usuario | null;
  estaAutenticado: boolean;
  /**
   * Guarda los tokens del login y carga el usuario. Lanza TokenInvalidoError
   * si lo que llegó no es un JWT vigente (y no guarda nada).
   */
  iniciarSesion: (tokens: Tokens) => void;
  /**
   * Pide al backend que revoque la sesión, borra los tokens locales y deja
   * la sesión como anónima. El logout local ocurre SIEMPRE, aunque la
   * revocación falle; `revocada` dice si el servidor la confirmó.
   */
  cerrarSesion: () => Promise<{ revocada: boolean }>;
  /**
   * Borra la sesión de este navegador SIN llamar al backend. Es para cuando
   * el backend ya la invalidó por su cuenta: p. ej. al restablecer la
   * contraseña (CH-07), que revoca todas las sesiones abiertas.
   */
  cerrarSesionLocal: () => void;
  /** Si el token venció mientras la pestaña estaba abierta, cierra la sesión. */
  verificarSesion: () => void;
  /**
   * Reemplaza los datos del usuario con los que confirmó el backend (p. ej.
   * después de editar el nombre en Perfil, CH-08), para que la barra
   * superior y el resto de la app muestren lo guardado sin recargar. Sin
   * sesión no hace nada.
   */
  actualizarUsuario: (usuario: Usuario) => void;
};

/** El login respondió 200 pero con un token que no sirve. */
export class TokenInvalidoError extends Error {
  constructor() {
    super("El servidor devolvió un token inválido");
  }
}

const AuthContext = createContext<ApiAuth | null>(null);

const MENSAJE_SESION_EXPIRADA = "Tu sesión expiró. Inicia sesión de nuevo.";

// Esperas entre reintentos de /usuarios/me/ cuando falla por algo temporal
// (backoff exponencial). Después del último se deja de insistir hasta que
// el navegador avise que volvió la conexión (evento `online`).
export const ESPERAS_REINTENTO_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

/** Fallas en las que tiene sentido reintentar: red, timeout, sobrecarga o 5xx. */
function esErrorTemporal(err: unknown): boolean {
  if (err instanceof ErrorDeApi) {
    return err.status >= 500 || err.status === 408 || err.status === 429;
  }
  return err instanceof TypeError; // fetch() sin red o servidor caído
}

function estadoInicial(): EstadoSesion {
  return haySesionValida() ? { tipo: "verificando" } : { tipo: "anonimo" };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoSesion>(estadoInicial);

  // Los callbacks registrados fuera de React (manejador 401, evento
  // `storage`) necesitan el estado actual sin re-registrarse en cada render.
  // Antes se hacía `estadoRef.current = estado` en el cuerpo del componente,
  // pero escribir refs durante el render va contra las reglas de React (un
  // render descartado dejaría la ref con un estado que nunca se aplicó).
  // Ahora la ref y el estado se cambian juntos, siempre por cambiarEstado().
  const estadoRef = useRef(estado);
  const cambiarEstado = useCallback((nuevo: EstadoSesion) => {
    estadoRef.current = nuevo;
    setEstado(nuevo);
  }, []);

  // Cada llamada a /usuarios/me/ lleva un número. Solo la última puede
  // tocar la sesión: si el usuario cerró sesión y volvió a entrar (o entró
  // otra cuenta en otra pestaña) mientras una petición vieja seguía en
  // vuelo, su respuesta llega tarde y se ignora. Sin esto, la respuesta
  // vieja ponía el usuario equivocado, o con un 401 borraba los tokens nuevos.
  const ultimaPeticion = useRef(0);

  // Token con el que se pidió el usuario actual, para detectar si otra
  // pestaña lo cambió (otro login) aunque la sesión siga siendo válida.
  const tokenConocido = useRef<string | null>(null);

  const cargarUsuario = useCallback(async () => {
    const id = ++ultimaPeticion.current;
    tokenConocido.current = obtenerAccessToken();
    // La petición sigue contando mientras nadie haya lanzado otra (ni
    // cerrado sesión): el mismo número sirve para cortar los reintentos.
    const vigente = () => id === ultimaPeticion.current && estadoRef.current.tipo !== "anonimo";

    for (let intento = 0; ; intento++) {
      try {
        const usuario = await getUsuarioActual();
        if (vigente()) cambiarEstado({ tipo: "autenticado", usuario });
        return;
      } catch (err: unknown) {
        if (!vigente()) return;
        if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
          // 401: el gateway rechazó el token. 404: el usuario del token ya no
          // existe. En ambos casos la sesión no sirve.
          logout();
          cambiarEstado({ tipo: "anonimo" });
          return;
        }
        // Red caída, 500, etc.: el token sigue siendo válido, así que no
        // echamos al usuario; seguimos dentro sin sus datos de perfil…
        const actual = estadoRef.current;
        if (actual.tipo !== "autenticado" || actual.usuario !== null) {
          cambiarEstado({ tipo: "autenticado", usuario: null });
        }
        // …y se reintenta solo, sin pedir un nuevo login (revisión CH-02).
        // Un 403 u otro 4xx no se arregla reintentando: ahí se para.
        if (!esErrorTemporal(err) || intento >= ESPERAS_REINTENTO_MS.length) return;
        await new Promise((resolver) => setTimeout(resolver, ESPERAS_REINTENTO_MS[intento]));
        if (!vigente()) return;
      }
    }
  }, [cambiarEstado]);

  // Pasa a "anonimo" e invalida cualquier /usuarios/me/ que siga en vuelo.
  const quedarAnonimo = useCallback(() => {
    ultimaPeticion.current++;
    tokenConocido.current = null;
    cambiarEstado({ tipo: "anonimo" });
  }, [cambiarEstado]);

  // Bootstrap al montar (= al cargar o recargar la página).
  useEffect(() => {
    if (!haySesionValida()) {
      // Token vencido o basura que quedó de antes: se limpia para que
      // `pedir()` no lo siga mandando en el header Authorization.
      logout();
      return;
    }
    void cargarUsuario();
  }, [cargarUsuario]);

  // Interceptor 401 de shared/api/cliente.ts. Antes main.tsx hacía
  // `window.location.href = "/login"`, que recargaba toda la app y perdía
  // el toast. Ahora basta con pasar a "anonimo": <RutaPrivada> redirige.
  useEffect(() => {
    configurarManejador401(() => {
      if (estadoRef.current.tipo === "anonimo") return;
      toast.info(MENSAJE_SESION_EXPIRADA);
      quedarAnonimo();
    });
    return () => configurarManejador401(() => {});
  }, [toast, quedarAnonimo]);

  // Sesión compartida entre pestañas: el evento `storage` solo llega a las
  // OTRAS pestañas del mismo origen cuando una cambia localStorage.
  useEffect(() => {
    function alCambiarStorage() {
      const valida = haySesionValida();
      const actual = estadoRef.current.tipo;
      if (!valida) {
        if (actual !== "anonimo") quedarAnonimo();
      } else if (actual === "anonimo") {
        // Se inició sesión en otra pestaña.
        cambiarEstado({ tipo: "verificando" });
        void cargarUsuario();
      } else if (obtenerAccessToken() !== tokenConocido.current) {
        // Sigue habiendo sesión, pero con otro token: en otra pestaña entró
        // otra cuenta. Se recarga el usuario para no mostrar el anterior.
        void cargarUsuario();
      }
      // Cualquier otra clave (p. ej. el tema claro/oscuro) no afecta la sesión.
    }
    window.addEventListener("storage", alCambiarStorage);
    return () => window.removeEventListener("storage", alCambiarStorage);
  }, [cargarUsuario, cambiarEstado, quedarAnonimo]);

  // Si se agotaron los reintentos sin red, se vuelve a probar apenas el
  // navegador avisa que hay conexión, también sin pedir login.
  useEffect(() => {
    function alVolverLaConexion() {
      const actual = estadoRef.current;
      if (actual.tipo === "autenticado" && actual.usuario === null && haySesionValida()) {
        void cargarUsuario();
      }
    }
    window.addEventListener("online", alVolverLaConexion);
    return () => window.removeEventListener("online", alVolverLaConexion);
  }, [cargarUsuario]);

  // Al desmontar se invalida la petición en curso: corta los reintentos
  // que estén esperando su turno.
  useEffect(() => {
    const peticiones = ultimaPeticion;
    return () => {
      peticiones.current++;
    };
  }, []);

  const iniciarSesion = useCallback(
    (tokens: Tokens) => {
      guardarTokens(tokens);
      // Si el token no es un JWT vigente, entrar igual terminaba en un
      // "Tu sesión expiró" apenas cambiaba la página, que confunde a quien
      // recién puso bien su contraseña. Se corta acá y Login muestra error.
      if (!haySesionValida()) {
        logout();
        throw new TokenInvalidoError();
      }
      cambiarEstado({ tipo: "autenticado", usuario: null });
      void cargarUsuario();
    },
    [cargarUsuario, cambiarEstado],
  );

  const cerrarSesion = useCallback(async () => {
    // Primero se revoca en el backend (necesita los tokens) y después se
    // borran los locales. Si la revocación falla igual se cierra la sesión
    // en este equipo: quien aprieta "Cerrar sesión" (p. ej. en un PC
    // compartido) tiene que quedar fuera sí o sí. Quien llama avisa al
    // usuario si `revocada` es false (revisión CH-03, depende de MX-29).
    const revocada = await revocarSesion();
    logout();
    quedarAnonimo();
    return { revocada };
  }, [quedarAnonimo]);

  const cerrarSesionLocal = useCallback(() => {
    logout();
    if (estadoRef.current.tipo !== "anonimo") quedarAnonimo();
  }, [quedarAnonimo]);

  const actualizarUsuario = useCallback(
    (usuario: Usuario) => {
      if (estadoRef.current.tipo !== "autenticado") return;
      cambiarEstado({ tipo: "autenticado", usuario });
    },
    [cambiarEstado],
  );

  const verificarSesion = useCallback(() => {
    if (estadoRef.current.tipo === "anonimo") return;
    if (!haySesionValida()) {
      logout();
      toast.info(MENSAJE_SESION_EXPIRADA);
      quedarAnonimo();
    }
  }, [toast, quedarAnonimo]);

  // Memorizado igual que en ToastContext: los consumidores solo se
  // re-renderizan cuando cambia el estado de la sesión.
  const api = useMemo<ApiAuth>(
    () => ({
      estado,
      usuario: estado.tipo === "autenticado" ? estado.usuario : null,
      estaAutenticado: estado.tipo === "autenticado",
      iniciarSesion,
      cerrarSesion,
      cerrarSesionLocal,
      verificarSesion,
      actualizarUsuario,
    }),
    [estado, iniciarSesion, cerrarSesion, cerrarSesionLocal, verificarSesion, actualizarUsuario],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): ApiAuth {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth() debe usarse dentro de <AuthProvider>");
  }
  return ctx;
}
