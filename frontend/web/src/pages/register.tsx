import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { Eye, User, Mail, Lock, Check } from "lucide-react";
import { register, AuthError } from "@ojoalgasto/shared";
import { useToast } from "../context/ToastContext";
import { Spinner } from "../components/Spinner";
import RegisterSuccess from "./registersuccess";
import "../styles/Register.css";

export default function Register() {
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // Igual que en Login: se quitó el estado `error` y el <p> inline. Tanto
  // las validaciones del formulario (contraseñas distintas, términos sin
  // aceptar) como los fallos del backend salen por toast, para que el
  // usuario vea un solo lugar donde aparecen los errores.

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
        // Ver el comentario equivalente en Login.tsx: fetch() no logró
        // conectarse, no es un problema de los datos del usuario.
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
      <div className="register-page">
        <div className="register-wrap">
          <div className="register-logo">
            <Eye size={20} />
            <span>Ojo al Gasto</span>
          </div>
          <RegisterSuccess nombre={nombre} />
        </div>
      </div>
    );
  }

  return (
    <div className="register-page">
      <div className="register-wrap">
        <div className="register-logo">
          <Eye size={20} />
          <span>Ojo al Gasto</span>
        </div>

        <form className="register-card" onSubmit={handleSubmit}>
          <div className="register-heading">
            <h1>Crea tu cuenta</h1>
            <p>Empieza a controlar tus suscripciones hoy mismo.</p>
          </div>

          <div className="register-field">
            <label htmlFor="nombre">NOMBRE COMPLETO</label>
            <div className="register-field-input">
              <User size={16} />
              <input
                id="nombre"
                type="text"
                autoComplete="name"
                placeholder="El papu"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="register-field">
            <label htmlFor="correo">CORREO ELECTRÓNICO</label>
            <div className="register-field-input">
              <Mail size={16} />
              <input
                id="correo"
                type="email"
                autoComplete="email"
                placeholder="usuario@ejemplo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="register-field">
            <label htmlFor="password">CONTRASEÑA</label>
            <div className="register-field-input">
              <Lock size={16} />
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="register-field">
            <label htmlFor="confirm">CONFIRMAR CONTRASEÑA</label>
            <div className="register-field-input">
              <Lock size={16} />
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="••••••••••••"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
            </div>
          </div>

          <label className="register-terms">
            <span
              role="checkbox"
              aria-checked={accepted}
              aria-label="Aceptar términos y condiciones"
              tabIndex={0}
              className={`register-checkbox${accepted ? " checked" : ""}`}
              onClick={(e) => {
                e.preventDefault();
                setAccepted(!accepted);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setAccepted(!accepted);
                }
              }}
            >
              {accepted && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="text">
              Acepto los <Link to="/terminos">Términos y condiciones</Link>
            </span>
          </label>

          <button
            type="submit"
            className="register-submit btn-con-spinner"
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner size={14} decorativo />
                Creando cuenta…
              </>
            ) : (
              "Crear cuenta"
            )}
          </button>

          <div className="register-divider">
            <span className="line" />
            <span className="dot" />
            <span className="line" />
          </div>

          <p className="register-switch">
            ¿Ya tienes cuenta? <Link to="/login">Inicia sesión</Link>
          </p>
        </form>
      </div>
    </div>
  );
}