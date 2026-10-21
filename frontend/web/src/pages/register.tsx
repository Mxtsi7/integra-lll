import { useState, FormEvent } from "react";
import { Link } from "react-router-dom";
import { User, Mail, Lock } from "lucide-react";
import {
  register,
  AuthError,
  validarRegistro,
  erroresRegistroDesdeServidor,
  type CampoRegistro,
  type ErroresRegistro,
} from "@ojoalgasto/shared";
import { useToast } from "../context/ToastContext";
import { PantallaAcceso } from "../components/layout/PantallaAcceso";
import { CampoContrasena, CampoTexto } from "../components/ui/Campo";
import { Boton } from "../components/ui/Boton";
import RegisterSuccess from "./registersuccess";
import styles from "./Acceso.module.css";

// Orden visual de los campos: al fallar, el foco va al primero con error.
const ORDEN_CAMPOS: CampoRegistro[] = ["nombre", "correo", "password", "confirmacion", "aceptaDatos"];
const ID_CAMPO: Record<CampoRegistro, string> = {
  nombre: "nombre",
  correo: "correo",
  password: "password",
  confirmacion: "confirm",
  aceptaDatos: "acepta-datos",
};

function enfocarPrimerError(errores: ErroresRegistro) {
  const campo = ORDEN_CAMPOS.find((c) => errores[c]);
  if (campo) document.getElementById(ID_CAMPO[campo])?.focus();
}

export default function Register() {
  const toast = useToast();
  const [nombre, setNombre] = useState("");
  const [correo, setCorreo] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  // CH-04: antes las validaciones y los errores del backend salían todos en
  // un toast (y del backend solo el primero). Ahora cada error va bajo su
  // campo; el toast queda para lo que no es de ningún campo (sin red, 500…).
  const [errores, setErrores] = useState<ErroresRegistro>({});

  // Al corregir un campo se borra su error; los demás se mantienen.
  function limpiarError(campo: CampoRegistro) {
    setErrores((actuales) => {
      if (!actuales[campo]) return actuales;
      const { [campo]: _, ...resto } = actuales;
      return resto;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;

    // Misma política que el backend (shared/validaciones.ts). Si algo no
    // cumple, NO se envía el registro.
    const locales = validarRegistro({
      nombre,
      correo,
      password,
      confirmacion: confirm,
      aceptaDatos: accepted,
    });
    setErrores(locales);
    if (Object.keys(locales).length > 0) {
      enfocarPrimerError(locales);
      return;
    }

    setLoading(true);
    try {
      await register({
        nombre: nombre.trim(),
        correo: correo.trim(),
        password, // sin recortar: los espacios son parte de la contraseña
        aceptaDatos: accepted,
      });
      // No redirigimos directo al dashboard: el diseño pide mostrar
      // "cuenta creada, ir a Login" en vez de loguear automáticamente.
      setSuccess(true);
    } catch (err: unknown) {
      if (err instanceof AuthError) {
        // El backend es la validación definitiva: su respuesta se muestra
        // siempre. Errores por campo → bajo cada campo; el resto → toast.
        const { porCampo, general } = err.campos
          ? erroresRegistroDesdeServidor(err.campos)
          : { porCampo: {}, general: [err.message] };
        setErrores(porCampo);
        enfocarPrimerError(porCampo);
        if (general.length > 0) toast.error(general.join(" "));
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
        <RegisterSuccess nombre={nombre.trim()} />
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
      {/* noValidate: los mensajes son los nuestros (iguales al backend), no
          los globos nativos del navegador, que cambian según el idioma. */}
      <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
        <CampoTexto
          id={ID_CAMPO.nombre}
          etiqueta="Nombre"
          type="text"
          autoComplete="name"
          placeholder="Cómo quieres que te llamemos"
          icono={<User size={16} />}
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            limpiarError("nombre");
          }}
          error={errores.nombre}
          required
        />

        <CampoTexto
          id={ID_CAMPO.correo}
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="email"
          placeholder="tu@correo.cl"
          icono={<Mail size={16} />}
          value={correo}
          onChange={(e) => {
            setCorreo(e.target.value);
            limpiarError("correo");
          }}
          error={errores.correo}
          required
        />

        {/* CH-05: cada campo de contraseña tiene su propio botón de ver/ocultar. */}
        <CampoContrasena
          id={ID_CAMPO.password}
          etiqueta="Contraseña"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          ayuda="Al menos 8 caracteres, con una letra y un número."
          icono={<Lock size={16} />}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            limpiarError("password");
          }}
          error={errores.password}
          required
        />

        <CampoContrasena
          id={ID_CAMPO.confirmacion}
          etiqueta="Repite la contraseña"
          autoComplete="new-password"
          placeholder="La misma de arriba"
          icono={<Lock size={16} />}
          value={confirm}
          onChange={(e) => {
            setConfirm(e.target.value);
            limpiarError("confirmacion");
          }}
          error={errores.confirmacion}
          required
        />

        <div>
          <label className={styles.terminos}>
            <input
              id={ID_CAMPO.aceptaDatos}
              type="checkbox"
              checked={accepted}
              onChange={(e) => {
                setAccepted(e.target.checked);
                limpiarError("aceptaDatos");
              }}
              aria-invalid={errores.aceptaDatos ? true : undefined}
              aria-describedby={errores.aceptaDatos ? "acepta-datos-error" : undefined}
            />
            <span>
              Acepto los <Link to="/terminos">términos y condiciones</Link> y el uso de mis datos
              para calcular mi gasto.
            </span>
          </label>
          {errores.aceptaDatos && (
            <p id="acepta-datos-error" className={styles.errorCampo}>
              {errores.aceptaDatos}
            </p>
          )}
        </div>

        <Boton type="submit" ancho cargando={loading}>
          {loading ? "Creando cuenta…" : "Crear cuenta"}
        </Boton>
      </form>
    </PantallaAcceso>
  );
}
