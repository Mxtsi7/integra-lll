import React, { useState } from "react";

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

const DEFAULT_MONEDAS = ["USD", "EUR", "CLP", "MXN", "ARS"];
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
    <form className="form-card" onSubmit={handleSubmit}>
      <div className="form-header-row">
        <div className="form-header-bar" />
        <h2 className="form-title">Editar Suscripción</h2>
      </div>
      <div className="form-subtitle">
        ID: {formData.id ?? "—"} {/* TODO: aquí carga el dato real del id */}
      </div>

      <div className="form-divider">
        <div className="form-divider-fill" />
      </div>

      <div className="info-banner">
        {/* Placeholder del icono informativo */}
        <div className="info-icon-placeholder" />
        <div className="info-text">
          Los cambios no afectarán el historial de cobros pasados.
        </div>
      </div>

      <div className="field">
        <label className="field-label">NOMBRE DEL SERVICIO</label>
        <input
          type="text"
          className="field-input"
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
        <label className="field-label">CATEGORÍA</label>
        <select
          className="field-select"
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

      <div className="field">
        <label className="field-label">NOTAS</label>
        <textarea
          className="field-textarea"
          placeholder="Añade notas sobre esta suscripción..."
          value={formData.notas}
          onChange={(e) => handleChange("notas", e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn-primary">
        GUARDAR CAMBIOS
      </button>

      <button type="button" className="btn btn-secondary" onClick={onCancel}>
        CANCELAR
      </button>
    </form>
  );
}

export default EditarSuscripcionForm;
