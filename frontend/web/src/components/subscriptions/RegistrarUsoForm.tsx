import React, { useState } from "react";
import { Clock } from "lucide-react";
import {
  ErrorDeApi,
  erroresDesdeServidor,
  hoyLocalIso,
  validarUso,
  type CampoUso,
  type ErroresUso,
} from "@ojoalgasto/shared";
import { CampoTexto } from "../ui/Campo";
import { Boton } from "../ui/Boton";
import styles from "./UsoSuscripcion.module.css";

interface RegistrarUsoFormProps {
  /**
   * Registra el uso en el backend (POST /suscripciones/<id>/uso/). Debe
   * lanzar si falla; el formulario muestra el error y conserva lo escrito.
   */
  /** `fecha` es undefined si el usuario dejó "Día" vacío: el backend usa hoy. */
  onRegistrar: (minutos: number, fecha?: string) => Promise<void>;
}

const ID_CAMPO: Record<CampoUso, string> = { minutos: "uso-minutos", fecha: "uso-fecha" };
const CAMPO_DESDE_API: Record<string, CampoUso> = { minutos: "minutos", fecha: "fecha" };

function formatoMinutos(minutos: number): string {
  return minutos === 1 ? "1 minuto" : `${minutos.toLocaleString("es-CL")} minutos`;
}

/**
 * Registrar minutos de uso desde el detalle (CH-14). Valida con las mismas
 * reglas que RegistrarUsoSerializer (enteros de 1 a 44.640, fecha no futura)
 * y el backend sigue siendo la validación definitiva.
 */
export function RegistrarUsoForm({ onRegistrar }: RegistrarUsoFormProps) {
  const hoy = hoyLocalIso();
  const [minutos, setMinutos] = useState("");
  // Se propone hoy; el contrato admite otra fecha pasada (o ninguna).
  const [fecha, setFecha] = useState(hoy);
  const [errores, setErrores] = useState<ErroresUso>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Un doble clic no registra dos veces el mismo uso.
    if (guardando) return;

    const locales = validarUso({ minutos, fecha }, hoy);
    setErrores(locales);
    setErrorGeneral(null);
    setConfirmacion(null);
    const primero = (Object.keys(ID_CAMPO) as CampoUso[]).find((c) => locales[c]);
    if (primero) {
      document.getElementById(ID_CAMPO[primero])?.focus();
      return;
    }

    const cantidad = Number(minutos.trim());
    setGuardando(true);
    try {
      // "Día" vacío no viaja como fecha: "" (el serializer lo rechaza); se
      // omite y el backend usa hoy (revisión PR #80).
      await onRegistrar(cantidad, fecha || undefined);
      setMinutos("");
      setConfirmacion(`Registraste ${formatoMinutos(cantidad)}.`);
    } catch (err: unknown) {
      if (err instanceof ErrorDeApi && err.campos) {
        const { porCampo, general } = erroresDesdeServidor(err.campos, CAMPO_DESDE_API);
        setErrores(porCampo);
        if (general.length > 0) setErrorGeneral(general.join(" "));
      } else if (err instanceof ErrorDeApi) {
        setErrorGeneral(err.message);
      } else if (err instanceof TypeError) {
        setErrorGeneral("No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.");
      } else {
        setErrorGeneral("No pudimos registrar el uso. Intenta de nuevo.");
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
      {errorGeneral && (
        <p className={styles.error} role="alert">
          {errorGeneral}
        </p>
      )}
      <div className={styles.filaCampos}>
        <CampoTexto
          id={ID_CAMPO.minutos}
          etiqueta="Minutos de uso"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ej: 45"
          icono={<Clock size={16} />}
          value={minutos}
          onChange={(e) => {
            setMinutos(e.target.value);
            setErrores((prev) => ({ ...prev, minutos: undefined }));
            setConfirmacion(null);
          }}
          error={errores.minutos}
        />
        <CampoTexto
          id={ID_CAMPO.fecha}
          etiqueta="Día"
          type="date"
          max={hoy}
          value={fecha}
          onChange={(e) => {
            setFecha(e.target.value);
            setErrores((prev) => ({ ...prev, fecha: undefined }));
          }}
          error={errores.fecha}
        />
      </div>
      <div className={styles.pieFormulario}>
        <p className={styles.confirmacion} role="status">
          {confirmacion}
        </p>
        <Boton type="submit" cargando={guardando}>
          {guardando ? "Registrando…" : "Registrar uso"}
        </Boton>
      </div>
    </form>
  );
}

export default RegistrarUsoForm;
