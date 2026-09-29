import React, { useState } from "react";
import styles from "./SusForm.module.css";
import type { Frecuencia, Moneda, Suscripcion } from "@ojoalgasto/shared";
import { CATEGORIAS, etiquetaFrecuencia } from "./presentacion";

export interface EditarSuscripcionFormData {
  id: string;
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: Suscripcion["categoria"];
  /**
   * OJO: `notas` no existe ni en el tipo `Suscripcion` ni en el modelo de
   * Django, así que hoy se escribe y se pierde. O se agrega al backend o se
   * saca del formulario; queda acá para no borrar el diseño sin conversarlo.
   */
  notas: string;
}

interface EditarSuscripcionFormProps {
  suscripcion?: EditarSuscripcionFormData;
  onSubmit?: (data: EditarSuscripcionFormData) => void;
  onCancel?: () => void;
  monedas?: Moneda[];
  frecuencias?: Frecuencia[];
}

const DEFAULT_MONEDAS: Moneda[] = ["CLP", "USD"];
// Solo 'mensual' | 'anual'. Antes había "Semanal" y "Trimestral", que el
// backend rechaza: el modelo solo acepta estos dos.
const DEFAULT_FRECUENCIAS: Frecuencia[] = ["mensual", "anual"];

const DEFAULT_SUSCRIPCION: EditarSuscripcionFormData = {
  id: "",
  nombre: "",
  monto: "",
  moneda: "CLP",
  frecuencia: "mensual",
  categoria: "otro",
  notas: "",
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
    notas: "",
  };
}

export function EditarSuscripcionForm({
  suscripcion = DEFAULT_SUSCRIPCION,
  onSubmit,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  frecuencias = DEFAULT_FRECUENCIAS,
}: EditarSuscripcionFormProps) {
  const [formData, setFormData] = useState<EditarSuscripcionFormData>(suscripcion);

  const handleChange = (
    field: keyof EditarSuscripcionFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value } as EditarSuscripcionFormData));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(formData);
  };

  return (
    <form className={styles.formCard} onSubmit={handleSubmit}>
      <div className={styles.formHeaderRow}>
        <div className={styles.formHeaderBar} />
        <h2 className={styles.formTitle}>Editar Suscripción</h2>
      </div>
      <div className={styles.formSubtitle}>{formData.nombre || "Suscripción"}</div>

      <div className={styles.formDivider}>
        <div className={styles.formDividerFill} />
      </div>

      <div className={styles.infoBanner}>
        {/* Placeholder del icono informativo */}
        <div className={styles.infoIconPlaceholder} />
        <div className={styles.infoText}>
          Los cambios no afectarán el historial de cobros pasados.
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>NOMBRE DEL SERVICIO</label>
        <input
          type="text"
          className={styles.fieldInput}
          value={formData.nombre}
          onChange={(e) => handleChange("nombre", e.target.value)}
        />
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>MONTO</label>
          <input
            type="number"
            step="0.01"
            className={styles.fieldInput}
            value={formData.monto}
            onChange={(e) => handleChange("monto", e.target.value)}
          />
        </div>

        <div className={`${styles.field} ${styles.fieldCurrency}`}>
          <label className={styles.fieldLabel}>MONEDA</label>
          <select
            className={styles.fieldSelect}
            value={formData.moneda}
            onChange={(e) => handleChange("moneda", e.target.value)}
          >
            {monedas.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>CICLO DE COBRO</label>
        <select
          className={styles.fieldSelect}
          value={formData.frecuencia}
          onChange={(e) => handleChange("frecuencia", e.target.value)}
        >
          {frecuencias.map((f) => (
            <option key={f} value={f}>
              {etiquetaFrecuencia(f)}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>CATEGORÍA</label>
        <select
          className={styles.fieldSelect}
          value={formData.categoria}
          onChange={(e) => handleChange("categoria", e.target.value)}
        >
          {CATEGORIAS.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>NOTAS</label>
        <textarea
          className={styles.fieldTextarea}
          placeholder="Añade notas sobre esta suscripción..."
          value={formData.notas}
          onChange={(e) => handleChange("notas", e.target.value)}
        />
      </div>

      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
        GUARDAR CAMBIOS
      </button>

      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onCancel}
      >
        CANCELAR
      </button>
    </form>
  );
}

export default EditarSuscripcionForm;
