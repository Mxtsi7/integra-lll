import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import { configurarManejador401, ErrorDeApi, getUsuarioActual, guardarTokens, haySesionValida, logout, type Usuario} from "@ojoalgasto/shared";
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
  /** Guarda los tokens del login y carga el usuario. */
  iniciarSesion: (tokens: Tokens) => void;
  /** Borra los tokens y deja la sesión como anónima. */
  cerrarSesion: () => void;
  /** Si el token venció mientras la pestaña estaba abierta, cierra la sesión. */
  verificarSesion: () => void;
};

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
  const estadoRef = useRef(estado);
  estadoRef.current = estado;

  const cargarUsuario = useCallback(async () => {
    try {
      const usuario = await getUsuarioActual();
      // Si mientras tanto se cerró la sesión, no la "revivimos".
      setEstado((actual) =>
        actual.tipo === "anonimo" ? actual : { tipo: "autenticado", usuario },
      );
    } catch (err: unknown) {
      if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
        // 401: el gateway rechazó el token. 404: el usuario del token ya no
        // existe. En ambos casos la sesión no sirve.
        logout();
        setEstado({ tipo: "anonimo" });
      } else {
        // Red caída, 500, etc.: el token sigue siendo válido, así que no
        // echamos al usuario; solo nos quedamos sin sus datos de perfil.
        setEstado((actual) =>
          actual.tipo === "anonimo" ? actual : { tipo: "autenticado", usuario: null },
        );
      }
    }
  }, []);

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
      if (estadoRef.current.tipo !== "anonimo") {
        toast.info(MENSAJE_SESION_EXPIRADA);
      }
      setEstado({ tipo: "anonimo" });
    });
    return () => configurarManejador401(() => {});
  }, [toast]);

  // Sesión compartida entre pestañas: el evento `storage` solo llega a las
  // OTRAS pestañas del mismo origen cuando una cambia localStorage.
  useEffect(() => {
    function alCambiarStorage() {
      const valida = haySesionValida();
      if (!valida && estadoRef.current.tipo !== "anonimo") {
        setEstado({ tipo: "anonimo" });
      } else if (valida && estadoRef.current.tipo === "anonimo") {
        setEstado({ tipo: "verificando" });
        void cargarUsuario();
      }
    }
    window.addEventListener("storage", alCambiarStorage);
    return () => window.removeEventListener("storage", alCambiarStorage);
  }, [cargarUsuario]);

  const iniciarSesion = useCallback(
    (tokens: Tokens) => {
      guardarTokens(tokens);
      setEstado({ tipo: "autenticado", usuario: null });
      void cargarUsuario();
    },
    [cargarUsuario],
  );

  const cerrarSesion = useCallback(() => {
    logout();
    setEstado({ tipo: "anonimo" });
  }, []);

  const verificarSesion = useCallback(() => {
    if (estadoRef.current.tipo === "anonimo") return;
    if (!haySesionValida()) {
      logout();
      toast.info(MENSAJE_SESION_EXPIRADA);
      setEstado({ tipo: "anonimo" });
    }
  }, [toast]);

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
