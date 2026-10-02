import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import "../styles/Toast.css";

// Los tipos viven acá (y no en ToastContext.tsx) para que este archivo no
// importe nada del contexto: ToastContext importa a ToastContainer para
// dibujarlo, y si el contenedor importara de vuelta al contexto quedaría
// una dependencia circular.
export type TipoToast = "error" | "exito" | "info";
export type Toast = { id: number; tipo: TipoToast; mensaje: string };

const ICONOS = {
  error: AlertCircle,
  exito: CheckCircle2,
  info: Info,
} as const;

type Props = {
  toasts: Toast[];
  alCerrar: (id: number) => void;
};

export function ToastContainer({ toasts, alCerrar }: Props) {
  return (
    <div className="toast-region" aria-live="polite">
      {toasts.map((t) => {
        const Icono = ICONOS[t.tipo];
        return (
          <div
            key={t.id}
            className={`toast toast-${t.tipo}`}
            // role="alert" hace que el lector de pantalla lo anuncie de
            // inmediato; solo se usa para errores. Éxito/info usan
            // role="status", que espera a que el lector termine de hablar.
            role={t.tipo === "error" ? "alert" : "status"}
          >
            <Icono size={18} className="toast-icono" />
            <p className="toast-mensaje">{t.mensaje}</p>
            <button
              type="button"
              className="toast-cerrar"
              aria-label="Cerrar notificación"
              onClick={() => alCerrar(t.id)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}