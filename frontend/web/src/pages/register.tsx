import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { User, Mail, Lock } from "lucide-react";
import { register, AuthError } from "@ojoalgasto/shared";
import { useToast } from "../context/ToastContext";
import { PantallaAcceso } from "../components/layout/PantallaAcceso";
import { CampoTexto } from "../components/ui/Campo";
import { Boton } from "../components/ui/Boton";
import RegisterSuccess from "./registersuccess";
import styles from "./Acceso.module.css";

export default function Register() {
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Tanto las validaciones del formulario como los fallos del backend salen
  // por toast: un solo lugar donde aparecen los errores.

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();

    if (password !== confirm) {
      toast.error("Las contraseñas no coinciden");
      return;
    }
    if (!accepted) {
      toast.error("Debes aceptar los términos y condiciones");
      return;
    }

    setLoading(true);
    try {
      await register({ nombre, correo, password, aceptaDatos: accepted });
      // No redirigimos directo al dashboard: el diseño pide mostrar
      // "cuenta creada, ir a Login" en vez de loguear automáticamente.
      setSuccess(true);
    } catch (err) {
      if (err instanceof AuthError) {
        toast.error(err.message);
      } else if (err instanceof TypeError) {
        toast.error("No se pudo conectar con el servidor. Intenta de nuevo en un momento.");
      } else {
        toast.error("No se pudo crear la cuenta. Intenta de nuevo.");
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <PantallaAcceso titulo="Cuenta creada">
        <RegisterSuccess nombre={nombre} />
      </PantallaAcceso>
    );
  }

  return (
    <PantallaAcceso
      titulo="Crea tu cuenta"
      descripcion="Gratis. En dos minutos sabes cuánto gastas en suscripciones."
      pie={
        <>
          ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
        </>
      }
    >
      <form className={styles.formulario} onSubmit={handleSubmit}>
        <CampoTexto
          id="nombre"
          etiqueta="Nombre"
          type="text"
          autoComplete="name"
          placeholder="Cómo quieres que te llamemos"
          icono={<User size={16} />}
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />

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
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          ayuda="Al menos 8 caracteres, con una letra y un número."
          icono={<Lock size={16} />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <CampoTexto
          id="confirm"
          etiqueta="Repite la contraseña"
          type="password"
          autoComplete="new-password"
          placeholder="La misma de arriba"
          icono={<Lock size={16} />}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />

        <label className={styles.terminos}>
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
          />
          <span>
            Acepto los <Link to="/terminos">términos y condiciones</Link> y el uso de mis datos
            para calcular mi gasto.
          </span>
        </label>

        <Boton type="submit" ancho cargando={loading}>
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Boton>
      </form>
    </PantallaAcceso>
  );
}
