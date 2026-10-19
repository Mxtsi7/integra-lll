import React, { useEffect, useState } from "react";
import type { Frecuencia, Moneda, Suscripcion } from "@ojoalgasto/shared";
import { CampoSelect, CampoTexto } from "../ui/Campo";
import { Boton } from "../ui/Boton";
import { CATEGORIAS, etiquetaFrecuencia } from "./presentacion";
import styles from "./SusForm.module.css";

export interface EditarSuscripcionFormData {
  id: string;
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: Suscripcion["categoria"];
}

interface EditarSuscripcionFormProps {
  suscripcion?: EditarSuscripcionFormData;
  onSubmit?: (data: EditarSuscripcionFormData) => void;
  onCancel?: () => void;
  monedas?: Moneda[];
  frecuencias?: Frecuencia[];
  /** true mientras el PATCH está en vuelo: deshabilita el botón de guardar. */
  isSaving?: boolean;
  /** Mensaje si el guardado falló. Se muestra dentro del formulario. */
  error?: string | null;
  /**
   * Avisa si hay cambios sin guardar respecto de los datos con que se abrió
   * (CH-16). Lo usa Homepage para preguntar antes de cerrar.
   */
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
}

const DEFAULT_MONEDAS: Moneda[] = ["CLP", "USD"];
// Solo 'mensual' | 'anual': el modelo del backend acepta solo estos dos.
const DEFAULT_FRECUENCIAS: Frecuencia[] = ["mensual", "anual"];

const DEFAULT_SUSCRIPCION: EditarSuscripcionFormData = {
  id: "",
  nombre: "",
  monto: "",
  moneda: "CLP",
  frecuencia: "mensual",
  categoria: "otro",
};

/** Pasa una suscripción del dominio al formulario. */
export function aFormulario(s: Suscripcion): EditarSuscripcionFormData {
  return {
    id: s.id,
    nombre: s.nombre,
    monto: String(s.monto),
    moneda: s.moneda,
    frecuencia: s.frecuencia,
    categoria: s.categoria,
  };
}

export function EditarSuscripcionForm({
  suscripcion = DEFAULT_SUSCRIPCION,
  onSubmit,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  frecuencias = DEFAULT_FRECUENCIAS,
  isSaving = false,
  error = null,
  onCambiosSinGuardar,
}: EditarSuscripcionFormProps) {
  const [formData, setFormData] = useState<EditarSuscripcionFormData>(suscripcion);
  // Los datos con que se abrió: contra ellos se comparan los cambios (CH-16).
  const [inicial] = useState<EditarSuscripcionFormData>(suscripcion);
  const hayCambios = (Object.keys(inicial) as (keyof EditarSuscripcionFormData)[]).some(
    (k) => formData[k] !== inicial[k],
  );
  useEffect(() => {
    onCambiosSinGuardar?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardar]);

  const handleChange = (field: keyof EditarSuscripcionFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }) as EditarSuscripcionFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(formData);
  };

  return (
    <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <CampoTexto
        etiqueta="Servicio"
        type="text"
        value={formData.nombre}
        onChange={(e) => handleChange("nombre", e.target.value)}
        autoFocus
      />

      <div className={styles.filaDoble}>
        <CampoTexto
          etiqueta="Monto"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={formData.monto}
          onChange={(e) => handleChange("monto", e.target.value)}
        />
        <CampoSelect
          etiqueta="Moneda"
          className={styles.moneda}
          value={formData.moneda}
          onChange={(e) => handleChange("moneda", e.target.value)}
        >
          {monedas.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </CampoSelect>
      </div>

      <div className={styles.filaDoble}>
        <CampoSelect
          etiqueta="Se cobra"
          value={formData.frecuencia}
          onChange={(e) => handleChange("frecuencia", e.target.value)}
        >
          {frecuencias.map((f) => (
            <option key={f} value={f}>
              {etiquetaFrecuencia(f)}
            </option>
          ))}
        </CampoSelect>
        <CampoSelect
          etiqueta="Categoría"
          value={formData.categoria}
          onChange={(e) => handleChange("categoria", e.target.value)}
        >
          {CATEGORIAS.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </CampoSelect>
      </div>

      <p className={styles.nota}>Los cambios no tocan los cobros que ya pasaron.</p>

      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={isSaving}>
          {isSaving ? "Guardando…" : "Guardar cambios"}
        </Boton>
      </div>
    </form>
  );
}

export default EditarSuscripcionForm;
