import { Link } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import "../styles/RegisterSuccess.css";

export default function RegisterSuccess({ nombre }: { nombre: string }) {
  return (
    <div className="register-success-card">
      <div className="register-success-icon">
        <CheckCircle2 size={28} color="white" />
      </div>
      <h1>¡Cuenta creada!</h1>
      <p>
        {nombre ? `Listo, ${nombre}. ` : "Listo. "}
        Ya puedes iniciar sesión con tu correo y contraseña.
      </p>
      <Link to="/login" className="register-success-button">
        Ir a iniciar sesión
      </Link>
    </div>
  );
}