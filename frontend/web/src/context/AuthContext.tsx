import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import { configurarManejador401, ErrorDeApi, getUsuarioActual, guardarTokens, haySesionValida, logout, obtenerAccessToken, type Usuario} from "@ojoalgasto/shared";
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
  /** Borra los tokens y deja la sesión como anónima. */
  cerrarSesion: () => void;
  /** Si el token venció mientras la pestaña estaba abierta, cierra la sesión. */
  verificarSesion: () => void;
};

/** El login respondió 200 pero con un token que no sirve. */
export class TokenInvalidoError extends Error {
  constructor() {
    super("El servidor devolvió un token inválido");
  }
}

const AuthContext = createContext<ApiAuth | null>(null);

const MENSAJE_SESION_EXPIRADA = "Tu sesión expiró. Inicia sesión de nuevo.";

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
    try {
      const usuario = await getUsuarioActual();
      if (id !== ultimaPeticion.current || estadoRef.current.tipo === "anonimo") return;
      cambiarEstado({ tipo: "autenticado", usuario });
    } catch (err: unknown) {
      if (id !== ultimaPeticion.current || estadoRef.current.tipo === "anonimo") return;
      if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
        // 401: el gateway rechazó el token. 404: el usuario del token ya no
        // existe. En ambos casos la sesión no sirve.
        logout();
        cambiarEstado({ tipo: "anonimo" });
      } else {
        // Red caída, 500, etc.: el token sigue siendo válido, así que no
        // echamos al usuario; solo nos quedamos sin sus datos de perfil.
        cambiarEstado({ tipo: "autenticado", usuario: null });
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

  const cerrarSesion = useCallback(() => {
    logout();
    quedarAnonimo();
  }, [quedarAnonimo]);

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
      verificarSesion,
    }),
    [estado, iniciarSesion, cerrarSesion, verificarSesion],
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
