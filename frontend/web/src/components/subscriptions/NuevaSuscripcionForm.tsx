import React, { useState } from "react";
import styles from "./SusForm.module.css";
import type { Frecuencia, Moneda, Suscripcion } from "@ojoalgasto/shared";
import { CATEGORIAS, etiquetaFrecuencia } from "./presentacion";

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: Suscripcion["categoria"];
  fechaDeCobro: string;
}

interface NuevaSuscripcionFormProps {
  /** Se llama con la suscripción lista, sin `id`: ese lo asigna el backend. */
  onAdd?: (suscripcion: Omit<Suscripcion, "id">) => void;
  onCancel?: () => void;
  monedas?: Moneda[];
  frecuencias?: Frecuencia[];
  /** true mientras el POST está en vuelo: deshabilita el botón de enviar. */
  isSaving?: boolean;
}

const DEFAULT_MONEDAS: Moneda[] = ["CLP", "USD"];
// Solo 'mensual' | 'anual': son los únicos valores que acepta el backend.
const DEFAULT_FRECUENCIAS: Frecuencia[] = ["mensual", "anual"];

const EMPTY_FORM = (
  monedas: Moneda[],
  frecuencias: Frecuencia[]
): NuevaSuscripcionFormData => ({
  nombre: "",
  monto: "",
  moneda: monedas[0],
  frecuencia: frecuencias[0],
  categoria: "otro",
  fechaDeCobro: "",
});

export function NuevaSuscripcionForm({
  onAdd,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  frecuencias = DEFAULT_FRECUENCIAS,
  isSaving = false,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(
    EMPTY_FORM(monedas, frecuencias)
  );

  const handleChange = (
    field: keyof NuevaSuscripcionFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value } as NuevaSuscripcionFormData));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const monto = parseFloat(formData.monto.replace(",", "."));
    if (!formData.nombre.trim() || Number.isNaN(monto)) return;

    onAdd?.({
      nombre: formData.nombre.trim(),
      monto,
      moneda: formData.moneda,
      frecuencia: formData.frecuencia,
      // La fecha viaja en ISO (YYYY-MM-DD), que es lo que espera la API.
      // Formatearla para mostrar es cosa de la pantalla, no del dato.
      fecha_proximo_cobro: formData.fechaDeCobro,
      categoria: formData.categoria,
      estado: "activo",
    });

    setFormData(EMPTY_FORM(monedas, frecuencias));
  };

  return (
    <form className={styles.formCard} onSubmit={handleSubmit}>
      <div className={styles.formHeaderRow}>
        <div className={styles.formHeaderBar} />
        <h2 className={styles.formTitle}>Nueva Suscripción</h2>
      </div>
      <div className={styles.formSubtitle}>Completa los datos para registrarla</div>

      <div className={styles.formDivider}>
        <div className={styles.formDividerFill} />
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel}>NOMBRE DEL SERVICIO</label>
        <input
          type="text"
          className={styles.fieldInput}
          placeholder="Ej. Spotify, AWS, GitHub..."
          value={formData.nombre}
          onChange={(e) => handleChange("nombre", e.target.value)}
          required
        />
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.fieldLabel}>MONTO</label>
          <input
            type="number"
            step="0.01"
            className={styles.fieldInput}
            placeholder="0"
            value={formData.monto}
            onChange={(e) => handleChange("monto", e.target.value)}
            required
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
        <label className={styles.fieldLabel}>FECHA DE COBRO</label>
          <input
            type="date"
            className={styles.fieldInput}
            value={formData.fechaDeCobro}
            onChange={(e) => handleChange("fechaDeCobro", e.target.value)}
            required
          />
      </div>

      <button
        type="submit"
        className={`${styles.btn} ${styles.btnPrimary}`}
        disabled={isSaving}
      >
        {isSaving ? "GUARDANDO..." : "REGISTRAR SUSCRIPCIÓN"}
      </button>

      <button
        type="button"
        className={`${styles.btn} ${styles.btnSecondary}`}
        onClick={onCancel}
        disabled={isSaving}
      >
        CANCELAR
      </button>
    </form>
  );
}

export default NuevaSuscripcionForm;