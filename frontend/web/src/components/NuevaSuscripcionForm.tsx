import React, { useState } from "react";

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: string;
  cicloDeCobro: string;
  fechaDeCobro: string;
}

interface NuevaSuscripcionFormProps {
  onSubmit?: (data: NuevaSuscripcionFormData) => void;
  onCancel?: () => void;
  monedas?: string[];
  ciclos?: string[];
}

const DEFAULT_MONEDAS = ["USD", "EUR", "CLP", "MXN", "ARS"];
const DEFAULT_CICLOS = ["Mensual", "Anual", "Semanal", "Trimestral"];

export function NuevaSuscripcionForm({
  onSubmit,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  ciclos = DEFAULT_CICLOS,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>({
    nombre: "",
    monto: "",
    moneda: monedas[0],
    cicloDeCobro: ciclos[0],
    fechaDeCobro: "",
  });

  const handleChange = (
    field: keyof NuevaSuscripcionFormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit?.(formData);
  };

  return (
    <form className="form-card" onSubmit={handleSubmit}>
      <div className="form-header-row">
        <div className="form-header-bar" />
        <h2 className="form-title">Nueva Suscripción</h2>
      </div>
      <div className="form-subtitle">Completa los datos para registrarla</div>

      <div className="form-divider">
        <div className="form-divider-fill" />
      </div>

      <div className="field">
        <label className="field-label">NOMBRE DEL SERVICIO</label>
        <input
          type="text"
          className="field-input"
          placeholder="Ej. Spotify, AWS, GitHub..."
          value={formData.nombre}
          onChange={(e) => handleChange("nombre", e.target.value)}
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label className="field-label">MONTO</label>
          <input
            type="number"
            step="0.01"
            className="field-input"
            placeholder="0.00"
            value={formData.monto}
            onChange={(e) => handleChange("monto", e.target.value)}
          />
        </div>

        <div className="field field--currency">
          <label className="field-label">MONEDA</label>
          <select
            className="field-select"
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

      <div className="field">
        <label className="field-label">CICLO DE COBRO</label>
        <select
          className="field-select"
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

      <div className="field">
        <label className="field-label">FECHA DE COBRO</label>
        <div className="date-wrapper">
          <input
            type="date"
            className="field-input"
            value={formData.fechaDeCobro}
            onChange={(e) => handleChange("fechaDeCobro", e.target.value)}
          />
          {/* Placeholder del icono de calendario */}
          <div className="icon-placeholder" />
        </div>
      </div>

      <button type="submit" className="btn btn-primary">
        REGISTRAR SUSCRIPCIÓN
      </button>

      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        CANCELAR
      </button>
    </form>
  );
}

export default NuevaSuscripcionForm;
