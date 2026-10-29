import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode} from "react";
import { configurarManejador401, ErrorDeApi, getUsuarioActual, guardarTokens, haySesionValida, logout, obtenerAccessToken, revocarSesion, sesionDelToken, type Usuario} from "@ojoalgasto/shared";
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

/**
 * Identifica una sesión: cambia al entrar, al salir y cuando otra pestaña
 * inicia sesión. Una operación que tarda (guardar el nombre, cambiar la
 * contraseña) la anota al empezar con `capturarSesion()` y se la pasa al
 * contexto al terminar, para que su respuesta no toque otra sesión.
 * Un refresh del access token no la cambia: sigue siendo la misma sesión.
 */
export type MarcaSesion = number;

type ApiAuth = {
  estado: EstadoSesion;
  usuario: Usuario | null;
  /**
   * La marca de la sesión vigente, como estado: cuando cambia, React vuelve
   * a renderizar. <RutaPrivada> la usa de `key` para que lo que mostraba una
   * cuenta no siga montado con otra (revisión de #128). Para decidir al
   * terminar una operación se usa `capturarSesion()`, que cambia al instante.
   */
  sesion: MarcaSesion;
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
   *
   * Con `sesion`, solo la borra si sigue siendo esa: la respuesta tardía de
   * una sesión que ya se fue no puede echar a la que entró después. Devuelve
   * si la borró.
   */
  cerrarSesionLocal: (sesion?: MarcaSesion) => boolean;
  /** Si el token venció mientras la pestaña estaba abierta, cierra la sesión. */
  verificarSesion: () => void;
  /** La sesión de este momento, para anotarla al empezar una operación. */
  capturarSesion: () => MarcaSesion;
  /**
   * Reemplaza los datos del usuario con los que confirmó el backend (p. ej.
   * después de editar el nombre en Perfil, CH-08), para que la barra
   * superior y el resto de la app muestren lo guardado sin recargar.
   *
   * No hace nada (y devuelve false) si `sesion` ya no es la vigente o si el
   * usuario confirmado no es el de la sesión: quien llama no debe mostrar
   * el resultado como propio.
   */
  actualizarUsuario: (usuario: Usuario, sesion: MarcaSesion) => boolean;
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

/** true si los dos tokens son de la misma sesión (uno es el refresh del otro). Si no se sabe, false. */
function esLaMismaSesion(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const sesion = sesionDelToken(a);
  return sesion !== null && sesion === sesionDelToken(b);
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

  // Número de la sesión vigente (MarcaSesion). No es `ultimaPeticion`: ese
  // cambia también al reintentar /usuarios/me/ dentro de la misma sesión,
  // y eso no debe descartar un guardado (revisión CH-08 en #99).
  const sesionVigente = useRef(0);
  // La misma marca como estado (`sesion` del contexto). La ref se lee al
  // instante; el estado es lo que hace volver a montar las pantallas.
  const [sesion, setSesion] = useState<MarcaSesion>(0);
  const nuevaSesion = useCallback(() => {
    sesionVigente.current++;
    setSesion(sesionVigente.current);
  }, []);

  const cargarUsuario = useCallback(async () => {
    const id = ++ultimaPeticion.current;
    tokenConocido.current = obtenerAccessToken();
    // La petición sigue contando mientras nadie haya lanzado otra (ni
    // cerrado sesión): el mismo número sirve para cortar los reintentos.
    const vigente = () => id === ultimaPeticion.current && estadoRef.current.tipo !== "anonimo";

    // Cuántas esperas de reintento van. Volver a preguntar tras un refresh
    // (más abajo) no gasta ninguna: no es una falla del servidor.
    let intento = 0;
    for (;;) {
      // El access con que sale esta consulta: pedir() lo lee al enviarla.
      const tokenDeLaConsulta = obtenerAccessToken();
      try {
        const usuario = await getUsuarioActual();
        if (vigente()) cambiarEstado({ tipo: "autenticado", usuario });
        return;
      } catch (err: unknown) {
        if (!vigente()) return;
        if (err instanceof ErrorDeApi && (err.status === 401 || err.status === 404)) {
          const tokenActual = obtenerAccessToken();
          if (tokenActual !== tokenDeLaConsulta) {
            // Revisión de #128: el rechazo es del token con que salió la
            // consulta y, mientras viajaba, se guardó otro. No puede borrar
            // el nuevo. Si es un refresh de la misma sesión, se vuelve a
            // preguntar con el vigente: cada repetición necesita otra
            // renovación, así que no queda dando vueltas. Si es otra sesión,
            // su carga la lanza quien la detecta (evento `storage` o
            // iniciarSesion) y esta termina sin tocar nada.
            if (esLaMismaSesion(tokenActual, tokenDeLaConsulta)) continue;
            return;
          }
          // 401: el gateway rechazó el token vigente. 404: el usuario del
          // token ya no existe. En ambos casos la sesión no sirve.
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
        await new Promise((resolver) => setTimeout(resolver, ESPERAS_REINTENTO_MS[intento++]));
        if (!vigente()) return;
      }
    }
  }, [cambiarEstado]);

  // Pasa a "anonimo" e invalida cualquier /usuarios/me/ que siga en vuelo.
  const quedarAnonimo = useCallback(() => {
    ultimaPeticion.current++;
    nuevaSesion();
    tokenConocido.current = null;
    cambiarEstado({ tipo: "anonimo" });
  }, [cambiarEstado, nuevaSesion]);

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
        nuevaSesion();
        cambiarEstado({ tipo: "verificando" });
        void cargarUsuario();
      } else if (obtenerAccessToken() !== tokenConocido.current) {
        const token = obtenerAccessToken();
        if (esLaMismaSesion(token, tokenConocido.current)) {
          // Solo se renovó el access (refresh): misma cuenta, misma sesión.
          // No se recarga nada, para no vaciar las pantallas abiertas.
          tokenConocido.current = token;
        } else {
          // Sigue habiendo sesión, pero es otra: en otra pestaña entró otra
          // cuenta. Se recarga el usuario para no mostrar el anterior.
          nuevaSesion();
          void cargarUsuario();
        }
      }
      // Cualquier otra clave (p. ej. el tema claro/oscuro) no afecta la sesión.
    }
    window.addEventListener("storage", alCambiarStorage);
    return () => window.removeEventListener("storage", alCambiarStorage);
  }, [cargarUsuario, cambiarEstado, quedarAnonimo, nuevaSesion]);

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
      nuevaSesion();
      cambiarEstado({ tipo: "autenticado", usuario: null });
      void cargarUsuario();
    },
    [cargarUsuario, cambiarEstado, nuevaSesion],
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

  const cerrarSesionLocal = useCallback(
    (sesion?: MarcaSesion) => {
      if (sesion !== undefined && sesion !== sesionVigente.current) return false;
      logout();
      if (estadoRef.current.tipo !== "anonimo") quedarAnonimo();
      return true;
    },
    [quedarAnonimo],
  );

  const capturarSesion = useCallback(() => sesionVigente.current, []);

  const actualizarUsuario = useCallback(
    (usuario: Usuario, sesion: MarcaSesion) => {
      const actual = estadoRef.current;
      if (sesion !== sesionVigente.current || actual.tipo !== "autenticado") return false;
      // Además de la marca, el usuario confirmado tiene que ser el de la
      // sesión (si ya se sabe quién es): nunca se mezclan dos cuentas.
      if (actual.usuario !== null && actual.usuario.id !== usuario.id) return false;
      cambiarEstado({ tipo: "autenticado", usuario });
      return true;
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
      sesion,
      iniciarSesion,
      cerrarSesion,
      cerrarSesionLocal,
      verificarSesion,
      capturarSesion,
      actualizarUsuario,
    }),
    [estado, sesion, iniciarSesion, cerrarSesion, cerrarSesionLocal, verificarSesion, capturarSesion, actualizarUsuario],
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
