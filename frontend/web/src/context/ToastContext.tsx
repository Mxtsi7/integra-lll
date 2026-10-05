import { createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ToastContainer, type Toast, type TipoToast} from "../components/ToastContainer";

const DURACION_MS = 5000;
// Tope de notificaciones visibles a la vez. Sin tope, un error que se
// repite (por ejemplo, el backend caído y varios intentos seguidos)
// apilaría toasts hasta tapar la pantalla.
const MAXIMO_VISIBLES = 4;

type ApiToast = {
  error: (mensaje: string) => void;
  exito: (mensaje: string) => void;
  info: (mensaje: string) => void;
};

const ToastContext = createContext<ApiToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const siguienteId = useRef(1);
  // Un temporizador por toast, guardados para poder cancelarlos si el
  // usuario lo cierra a mano antes de tiempo o si el provider se desmonta.
  const temporizadores = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const cerrar = useCallback((id: number) => {
    const t = temporizadores.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      temporizadores.current.delete(id);
    }
    setToasts((actuales) => actuales.filter((x) => x.id !== id));
  }, []);

  const mostrar = useCallback(
    (tipo: TipoToast, mensaje: string) => {
      const id = siguienteId.current++;
      setToasts((actuales) => [...actuales, { id, tipo, mensaje }].slice(-MAXIMO_VISIBLES));
      temporizadores.current.set(id, setTimeout(() => cerrar(id), DURACION_MS));
    },
    [cerrar],
  );

  useEffect(() => {
    const mapa = temporizadores.current;
    return () => {
      mapa.forEach((t) => clearTimeout(t));
      mapa.clear();
    };
  }, []);

  // useMemo para que el objeto tenga identidad estable: si cambiara en cada
  // render, cualquier componente que lo ponga en las dependencias de un
  // useEffect se re-ejecutaría sin parar.
  const api = useMemo<ApiToast>(
    () => ({
      error: (m) => mostrar("error", m),
      exito: (m) => mostrar("exito", m),
      info: (m) => mostrar("info", m),
    }),
    [mostrar],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} alCerrar={cerrar} />
    </ToastContext.Provider>
  );
}

export function useToast(): ApiToast {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast debe usarse dentro de <ToastProvider>");
  }
  return ctx;
}