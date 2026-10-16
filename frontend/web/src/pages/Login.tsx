import { useState, FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Mail, Lock } from "lucide-react";
import { login, AuthError } from "@ojoalgasto/shared";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { destinoTrasLogin } from "../components/RutaPrivada";
import { PantallaAcceso } from "../components/layout/PantallaAcceso";
import { CampoTexto } from "../components/ui/Campo";
import { Boton } from "../components/ui/Boton";
import styles from "./Acceso.module.css";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const { iniciarSesion } = useAuth();
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // Los fallos salen como toast (tarea "Integrar Toasts de error en fallos de
  // Login/Register"): un solo lugar donde aparecen los errores.

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { access_token, refresh_token } = await login({ correo, password });
      // Pasa por el AuthContext para que la app sepa al instante que hay
      // sesión (si no, <RutaPrivada> seguiría viendo "anonimo").
      iniciarSesion({ access_token, refresh_token });
      // Vuelve a la página privada que se quiso abrir sin sesión, o al panel.
      navigate(destinoTrasLogin(location), { replace: true });
    } catch (err) {
      if (err instanceof AuthError && err.status === 401) {
        toast.error("Usuario o contraseña inválidos");
      } else if (err instanceof AuthError) {
        toast.error(err.message);
      } else if (err instanceof TypeError) {
        // fetch() lanza TypeError cuando no logra ni conectarse (servidor
        // caído, sin red, CORS). Separarlo de "credenciales inválidas" evita
        // que alguien resetee una clave que estaba bien.
        toast.error("No se pudo conectar con el servidor. Intenta de nuevo en un momento.");
      } else {
        toast.error("No se pudo iniciar sesión. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <PantallaAcceso
      titulo="Bienvenido de nuevo"
      descripcion="Entra para ver cómo van tus suscripciones."
      pie={
        <>
          ¿No tienes cuenta? <Link to="/registro">Crea una</Link>
        </>
      }
    >
      <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
        <CampoTexto
          id="correo"
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.cl"
          icono={<Mail size={16} />}
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          required
        />

        <CampoTexto
          id="password"
          etiqueta="Contraseña"
          type="password"
          autoComplete="current-password"
          placeholder="Tu contraseña"
          icono={<Lock size={16} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <div className={styles.enlaceDerecha}>
          <Link to="/recuperar-contrasena">¿Olvidaste tu contraseña?</Link>
        </div>

        <Boton type="submit" ancho cargando={loading}>
          {loading ? "Ingresando…" : "Iniciar sesión"}
        </Boton>
      </form>
    </PantallaAcceso>
  );
}
