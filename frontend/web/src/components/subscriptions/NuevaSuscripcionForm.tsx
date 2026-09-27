import React, { useState } from "react";
import styles from "./SusForm.module.css";
import { Subscription } from "./Subscriptionitem";
// 👆 ajusta esta ruta si Subscriptionitem no está en la misma carpeta

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: string;
  cicloDeCobro: Subscription["cycle"];
  fechaDeCobro: string;
}

interface NuevaSuscripcionFormProps {
  /** Se llama con el objeto ya en el shape que espera la lista de suscripciones. */
  onAdd?: (subscription: Omit<Subscription, "id">) => void;
  onCancel?: () => void;
  monedas?: string[];
  ciclos?: Subscription["cycle"][];
}

const DEFAULT_MONEDAS = ["CLP", "USD"];
// Solo "Mensual" | "Anual": son los únicos valores que acepta Subscription["cycle"]
const DEFAULT_CICLOS: Subscription["cycle"][] = ["Mensual", "Anual"];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CLP: "$",
};

const PALETTE = ["#e50914", "#1db954", "#f5a623", "#6c3ce9", "#0070d1", "#da1f26", "#7d2ae8"];
const randomColor = () => PALETTE[Math.floor(Math.random() * PALETTE.length)];

const MESES_ABBR = [
  "Ene", "Feb", "Mar", "Abr", "May", "Jun",
  "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
];

// "2026-11-02" -> "02 Nov". Se parsea por partes (no con Date) para
// evitar corrimientos de un día por zona horaria.
const formatNextChargeDate = (isoDate: string): string => {
  if (!isoDate) return "—";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return "—";
  return `${String(day).padStart(2, "0")} ${MESES_ABBR[month - 1]}`;
};

const EMPTY_FORM = (monedas: string[], ciclos: Subscription["cycle"][]): NuevaSuscripcionFormData => ({
  nombre: "",
  monto: "",
  moneda: monedas[0],
  cicloDeCobro: ciclos[0],
  fechaDeCobro: "",
});

export function NuevaSuscripcionForm({
  onAdd,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  ciclos = DEFAULT_CICLOS,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(
    EMPTY_FORM(monedas, ciclos)
  );

  const handleChange = (
    field: keyof NuevaSuscripcionFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value } as NuevaSuscripcionFormData));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const price = parseFloat(formData.monto.replace(",", "."));
    if (!formData.nombre.trim() || Number.isNaN(price)) return;

    onAdd?.({
      name: formData.nombre.trim(),
      initial: formData.nombre.trim().charAt(0).toUpperCase(),
      color: randomColor(),
      cycle: formData.cicloDeCobro,
      price,
      currency: CURRENCY_SYMBOLS[formData.moneda] ?? formData.moneda,
      nextChargeDate: formatNextChargeDate(formData.fechaDeCobro),
      hasAlert: false,
    });

    setFormData(EMPTY_FORM(monedas, ciclos));
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
            placeholder="0.00"
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
        <label className={styles.fieldLabel}>FECHA DE COBRO</label>
        <div className={styles.dateWrapper}>
          <input
            type="date"
            className={styles.fieldInput}
            value={formData.fechaDeCobro}
            onChange={(e) => handleChange("fechaDeCobro", e.target.value)}
          />
          {/* Placeholder del icono de calendario */}
          <div className={styles.iconPlaceholder} />
        </div>
      </div>

      <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
        REGISTRAR SUSCRIPCIÓN
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

export default NuevaSuscripcionForm;