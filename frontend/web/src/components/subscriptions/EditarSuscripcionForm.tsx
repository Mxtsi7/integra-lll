import React, { useEffect, useState } from "react";
import type { Frecuencia, Moneda, Suscripcion } from "@ojoalgasto/shared";
import { CampoSelect, CampoTexto } from "../ui/Campo";
import { Boton } from "../ui/Boton";
import { EstadoCargaCatalogos, useCatalogos } from "../../context/CatalogosContext";
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

const DEFAULT_SUSCRIPCION: EditarSuscripcionFormData = {
  id: "",
  nombre: "",
  monto: "",
  moneda: "",
  frecuencia: "" as Frecuencia,
  categoria: "",
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

  const { datos, cargando, error: errorCatalogo } = useCatalogos();
  const monedas = datos?.monedas ?? [];
  const categorias = datos?.categorias ?? [];
  const frecuencias = datos?.frecuencias ?? [];
  const monedasPermitidas = monedas.filter((o) => o.activo || o.codigo === suscripcion.moneda);
  const categoriasPermitidas = categorias.filter((o) => o.activo || o.codigo === suscripcion.categoria);
  const listo = !!datos && !cargando && !errorCatalogo
    && monedasPermitidas.length > 0 && categoriasPermitidas.length > 0 && frecuencias.length > 0;
  const seleccionValida = monedasPermitidas.some((o) => o.codigo === formData.moneda)
    && categoriasPermitidas.some((o) => o.codigo === formData.categoria)
    && frecuencias.some((o) => o.codigo === formData.frecuencia);

  const handleChange = (field: keyof EditarSuscripcionFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }) as EditarSuscripcionFormData);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!listo || !seleccionValida || isSaving) return;
    onSubmit?.(formData);
  };

  return (
    <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <EstadoCargaCatalogos sinOpciones={!!datos && !listo} />
      <fieldset disabled={isSaving || !listo} className={styles.campos}>
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
            {!formData.moneda && <option value="">Selecciona una moneda</option>}
            {monedasPermitidas.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre} ({m.codigo}){!m.activo && " (inactiva)"}
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
            {!formData.frecuencia && <option value="">Selecciona frecuencia</option>}
            {frecuencias.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nombre}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect
            etiqueta="Categoría"
            value={formData.categoria}
            onChange={(e) => handleChange("categoria", e.target.value)}
          >
            {!formData.categoria && <option value="">Selecciona una categoría</option>}
            {categoriasPermitidas.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre}{!c.activo && " (inactiva)"}
              </option>
            ))}
          </CampoSelect>
        </div>

        <p className={styles.nota}>Los cambios no tocan los cobros que ya pasaron.</p>

      </fieldset>
      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={isSaving} disabled={!listo || !seleccionValida}>
          {isSaving ? "Guardando…" : "Guardar cambios"}
        </Boton>
      </div>
    </form>
  );
}

export default EditarSuscripcionForm;
