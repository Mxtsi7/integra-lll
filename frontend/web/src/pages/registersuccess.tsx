import { CheckCircle2 } from "lucide-react";
import { BotonEnlace } from "../components/ui/Boton";
import styles from "./Acceso.module.css";

export default function RegisterSuccess({ nombre }: { nombre: string }) {
  return (
    <div className={styles.resultado}>
      <span className={styles.resultadoIcono}>
        <CheckCircle2 size={26} aria-hidden="true" />
      </span>
      <p className={styles.resultadoTexto}>
        {nombre ? `Listo, ${nombre}. ` : "Listo. "}
        Ya puedes iniciar sesión con tu correo y contraseña.
      </p>
      <BotonEnlace to="/login">Ir a iniciar sesión</BotonEnlace>
    </div>
  );
}
