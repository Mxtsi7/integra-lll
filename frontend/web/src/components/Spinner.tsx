import "../styles/Spinner.css";

type Props = {
  size?: number;
  etiqueta?: string;
  // Dentro de un botón que ya dice "Ingresando…", el lector de pantalla
  // anunciaría dos veces lo mismo (el texto y el spinner). Con
  // `decorativo` el spinner se oculta para tecnologías de asistencia.
  decorativo?: boolean;
};

export function Spinner({ size = 16, etiqueta = "Cargando", decorativo = false }: Props) {
  const estilo = { width: size, height: size };

  if (decorativo) {
    return <span className="spinner" style={estilo} aria-hidden="true" />;
  }
  return <span className="spinner" style={estilo} role="status" aria-label={etiqueta} />;
}