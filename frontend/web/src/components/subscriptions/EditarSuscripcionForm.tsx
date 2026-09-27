import React, { useState } from "react";
import styles from "./SusForm.module.css";

export interface EditarSuscripcionFormData {
  id?: string; // TODO: aquí carga el dato real del id de la suscripción
  nombre: string;
  monto: string;
  moneda: string;
  cicloDeCobro: string;
  categoria: string;
  notas: string;
}

interface EditarSuscripcionFormProps {
  suscripcion?: EditarSuscripcionFormData;
  onSubmit?: (data: EditarSuscripcionFormData) => void;
  onCancel?: () => void;
  monedas?: string[];
  ciclos?: string[];
  categorias?: string[];
}

const DEFAULT_MONEDAS = ["CLP","USD"];
const DEFAULT_CICLOS = ["Mensual", "Anual", "Semanal", "Trimestral"];
const DEFAULT_CATEGORIAS = [
  "Entretenimiento",
  "Alimentación",
  "Productividad",
  "Salud",
  "Educación",
  "Otro",
];

const DEFAULT_SUSCRIPCION: EditarSuscripcionFormData = {
  id: undefined, // TODO: aquí carga el dato real del id de la suscripción
  nombre: "",
  monto: "",
  moneda: "USD",
  cicloDeCobro: "Mensual",
  categoria: "Entretenimiento",
  notas: "",
};

export function EditarSuscripcionForm({
  suscripcion = DEFAULT_SUSCRIPCION,
  onSubmit,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  ciclos = DEFAULT_CICLOS,
  categorias = DEFAULT_CATEGORIAS,
}: EditarSuscripcionFormProps) {
  const [formData, setFormData] = useState<EditarSuscripcionFormData>(suscripcion);

  const handleChange = (
    field: keyof EditarSuscripcionFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
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
      <div className={styles.formSubtitle}>
        ID: {formData.id ?? "—"} {/* TODO: aquí carga el dato real del id */}
      </div>

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
          value={formData.cicloDeCobro}
          onChange={(e) => handleChange("cicloDeCobro", e.target.value)}
        >
          {ciclos.map((c) => (
            <option key={c} value={c}>
              {c}
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
          {categorias.map((c) => (
            <option key={c} value={c}>
              {c}
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