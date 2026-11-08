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
export function aFormulario(suscripcion: Suscripcion): EditarSuscripcionFormData {
  return {
    id: suscripcion.id,
    nombre: suscripcion.nombre,
    monto: String(suscripcion.monto),
    moneda: suscripcion.moneda,
    frecuencia: suscripcion.frecuencia,
    categoria: suscripcion.categoria,
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
    (campo) => formData[campo] !== inicial[campo],
  );
  useEffect(() => {
    onCambiosSinGuardar?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardar]);

  const { datos, cargando, error: errorCatalogo } = useCatalogos();
  const monedas = datos?.monedas ?? [];
  const categorias = datos?.categorias ?? [];
  const frecuencias = datos?.frecuencias ?? [];
  const monedasPermitidas = monedas.filter((opcion) => opcion.activo || opcion.codigo === suscripcion.moneda);
  const categoriasPermitidas = categorias.filter((opcion) => opcion.activo || opcion.codigo === suscripcion.categoria);
  const listo = !!datos && !cargando && !errorCatalogo
    && monedasPermitidas.length > 0 && categoriasPermitidas.length > 0 && frecuencias.length > 0;
  const seleccionValida = monedasPermitidas.some((opcion) => opcion.codigo === formData.moneda)
    && categoriasPermitidas.some((opcion) => opcion.codigo === formData.categoria)
    && frecuencias.some((opcion) => opcion.codigo === formData.frecuencia);

  const handleChange = (field: keyof EditarSuscripcionFormData, value: string) => {
    setFormData((actual) => ({ ...actual, [field]: value }) as EditarSuscripcionFormData);
  };

  const handleSubmit = (evento: React.FormEvent) => {
    evento.preventDefault();
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
          onChange={(evento) => handleChange("nombre", evento.target.value)}
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
            onChange={(evento) => handleChange("monto", evento.target.value)}
          />
          <CampoSelect
            etiqueta="Moneda"
            className={styles.moneda}
            value={formData.moneda}
            onChange={(evento) => handleChange("moneda", evento.target.value)}
          >
            {!formData.moneda && <option value="">Selecciona una moneda</option>}
            {monedasPermitidas.map((moneda) => (
              <option key={moneda.codigo} value={moneda.codigo}>
                {moneda.nombre} ({moneda.codigo}){!moneda.activo && " (inactiva)"}
              </option>
            ))}
          </CampoSelect>
        </div>

        <div className={styles.filaDoble}>
          <CampoSelect
            etiqueta="Se cobra"
            value={formData.frecuencia}
            onChange={(evento) => handleChange("frecuencia", evento.target.value)}
          >
            {!formData.frecuencia && <option value="">Selecciona frecuencia</option>}
            {frecuencias.map((opcion) => (
              <option key={opcion.codigo} value={opcion.codigo}>
                {opcion.nombre}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect
            etiqueta="Categoría"
            value={formData.categoria}
            onChange={(evento) => handleChange("categoria", evento.target.value)}
          >
            {!formData.categoria && <option value="">Selecciona una categoría</option>}
            {categoriasPermitidas.map((nombreDeCampo) => (
              <option key={nombreDeCampo.codigo} value={nombreDeCampo.codigo}>
                {nombreDeCampo.nombre}{!nombreDeCampo.activo && " (inactiva)"}
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
