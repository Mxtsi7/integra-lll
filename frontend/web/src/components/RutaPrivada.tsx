import { useEffect } from "react";
import { Navigate, Outlet, useLocation, type Location } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Spinner } from "./Spinner";
import "../styles/RutaPrivada.css";

const RUTA_POR_DEFECTO = "/dashboard";

/**
 * A dónde ir después de iniciar sesión: la página privada que el usuario
 * quiso abrir sin sesión (la guarda <RutaPrivada> en `state.desde`) o el
 * panel. Solo se aceptan rutas internas ("/algo", nunca "//otro-sitio").
 */
export function destinoTrasLogin(location: Location): string {
  const estado: unknown = location.state;
  if (typeof estado === "object" && estado !== null && "desde" in estado) {
    const desde = (estado as { desde: unknown }).desde;
    if (typeof desde === "string" && desde.startsWith("/") && !desde.startsWith("//")) {
      return desde;
    }
  }
  return RUTA_POR_DEFECTO;
}

function PantallaVerificando() {
  return (
    <div className="ruta-verificando">
      <Spinner size={28} etiqueta="Verificando tu sesión" />
    </div>
  );
}

/** Rutas que exigen sesión: Home, Panel, Perfil, Configuración, detalle. */
export function RutaPrivada() {
  const { estado, sesion, verificarSesion } = useAuth();
  const location = useLocation();

  // El token puede vencer con la pestaña abierta; se revisa en cada
  // cambio de página para no mostrar una pantalla que va a fallar con 401.
  useEffect(() => {
    verificarSesion();
  }, [location.pathname, verificarSesion]);

  if (estado.tipo === "verificando") return <PantallaVerificando />;

  if (estado.tipo === "anonimo") {
    return (
      <Navigate
        to="/login"
        replace
        state={{ desde: `${location.pathname}${location.search}` }}
      />
    );
  }

  // Si otra pestaña entra con otra cuenta, la ruta sigue igual pero cambia
  // la marca de sesión: con ella de `key`, todo lo privado se desmonta y se
  // vuelve a montar desde cero. Ninguna pantalla sigue mostrando (ni puede
  // usar) datos o acciones de la cuenta anterior (revisión de #128). Un
  // refresh del token no cambia la marca, así que no vacía nada.
  return <Outlet key={sesion} />;
}

/** Login y registro: con sesión activa no tiene sentido verlos. */
export function SoloInvitados() {
  const { estado } = useAuth();
  const location = useLocation();

  if (estado.tipo === "verificando") return <PantallaVerificando />;
  if (estado.tipo === "autenticado") {
    return <Navigate to={destinoTrasLogin(location)} replace />;
  }
  return <Outlet />;
}
