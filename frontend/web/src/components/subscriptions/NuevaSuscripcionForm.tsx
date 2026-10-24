import React, { useEffect, useState } from "react";
import type { Frecuencia, Moneda, Suscripcion } from "@ojoalgasto/shared";
import { CampoSelect, CampoTexto } from "../ui/Campo";
import { Boton } from "../ui/Boton";
import { EstadoCargaCatalogos, useCatalogos } from "../../context/CatalogosContext";
import styles from "./SusForm.module.css";

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: Suscripcion["categoria"];
  fechaDeCobro: string;
}

interface NuevaSuscripcionFormProps {
  /**
   * Se llama con la suscripción lista, sin `id`: ese lo asigna el backend.
   * Devuelve `true` si el guardado fue exitoso. El form solo se limpia
   * cuando la respuesta es `true`; si falla (o se devuelve `false`), los
   * datos tipeados por el usuario se mantienen para que no tenga que
   * reescribirlos.
   */
  onAdd?: (suscripcion: Omit<Suscripcion, "id">) => Promise<boolean> | boolean;
  onCancel?: () => void;
  /** true mientras el POST está en vuelo: deshabilita el botón de enviar. */
  isSaving?: boolean;
  /** Mensaje del backend si el guardado falló. Se muestra dentro del formulario. */
  error?: string | null;
}

const EMPTY_FORM = (): NuevaSuscripcionFormData => ({
  nombre: "",
  monto: "",
  moneda: "",
  frecuencia: "" as Frecuencia,
  categoria: "",
  fechaDeCobro: "",
});

export function NuevaSuscripcionForm({
  onAdd,
  onCancel,
  isSaving = false,
  error = null,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(EMPTY_FORM());
  const [errorLocal, setErrorLocal] = useState<string | null>(null);

  const { datos, cargando, error: errorCatalogo } = useCatalogos();
  const monedas = datos?.monedas ?? [];
  const categorias = datos?.categorias ?? [];
  const frecuencias = datos?.frecuencias ?? [];
  const listo = !!datos && !cargando && !errorCatalogo
    && monedas.some((o) => o.activo) && categorias.some((o) => o.activo) && frecuencias.length > 0;
  const seleccionValida = monedas.some((o) => o.activo && o.codigo === formData.moneda)
    && categorias.some((o) => o.activo && o.codigo === formData.categoria)
    && frecuencias.some((o) => o.codigo === formData.frecuencia);
  useEffect(() => {
    if (!datos) return;
    setFormData((actual) => ({ ...actual,
      moneda: actual.moneda || datos.predeterminados.moneda || '',
      categoria: actual.categoria || datos.predeterminados.categoria || '',
      frecuencia: actual.frecuencia || datos.predeterminados.frecuencia,
    }));
  }, [datos]);

  const handleChange = (field: keyof NuevaSuscripcionFormData, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }) as NuevaSuscripcionFormData);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!listo || !seleccionValida || isSaving) return;

    const monto = parseFloat(formData.monto.replace(",", "."));
    if (!formData.nombre.trim() || Number.isNaN(monto) || monto <= 0) {
      setErrorLocal("Revisa el nombre y el monto: el monto tiene que ser mayor que cero.");
      return;
    }
    if (!formData.fechaDeCobro) {
      setErrorLocal("Falta la fecha del próximo cobro.");
      return;
    }
    setErrorLocal(null);

    const exito = await onAdd?.({
      nombre: formData.nombre.trim(),
      monto,
      moneda: formData.moneda,
      frecuencia: formData.frecuencia,
      // La fecha viaja en ISO (YYYY-MM-DD), que es lo que espera la API.
      fecha_proximo_cobro: formData.fechaDeCobro,
      categoria: formData.categoria,
      estado: "activo",
    });

    // Solo se limpia si el guardado salió bien; si falló, el usuario no
    // pierde lo que ya había escrito.
    if (exito) {
      setFormData({ ...EMPTY_FORM(), moneda: datos?.predeterminados.moneda ?? '',
        categoria: datos?.predeterminados.categoria ?? '', frecuencia: datos?.predeterminados.frecuencia ?? '' as Frecuencia });
    }
  };

  const mensajeError = errorLocal ?? error;

  return (
    <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
      {mensajeError && (
        <p className={styles.error} role="alert">
          {mensajeError}
        </p>
      )}

      <EstadoCargaCatalogos sinOpciones={!!datos && !listo} />
      <fieldset disabled={isSaving || !listo} className={styles.campos}>
        <CampoTexto
          etiqueta="Servicio"
          type="text"
          placeholder="Netflix, Spotify, el gimnasio…"
          value={formData.nombre}
          onChange={(e) => handleChange("nombre", e.target.value)}
          autoFocus
          required
        />

        <div className={styles.filaDoble}>
          <CampoTexto
            etiqueta="Monto"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            placeholder="0"
            value={formData.monto}
            onChange={(e) => handleChange("monto", e.target.value)}
            required
          />
          <CampoSelect
            etiqueta="Moneda"
            className={styles.moneda}
            value={formData.moneda}
            onChange={(e) => handleChange("moneda", e.target.value)}
          >
            {!monedas.some((o) => o.activo && o.codigo === formData.moneda) && <option value={formData.moneda}>Selecciona una moneda</option>}
            {monedas.filter((o) => o.activo).map((m) => (
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
            {!categorias.some((o) => o.activo && o.codigo === formData.categoria) && <option value={formData.categoria}>Selecciona una categoría</option>}
            {categorias.filter((o) => o.activo).map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre}{!c.activo && " (inactiva)"}
              </option>
            ))}
          </CampoSelect>
        </div>

        <CampoTexto
          etiqueta="Próximo cobro"
          type="date"
          value={formData.fechaDeCobro}
          onChange={(e) => handleChange("fechaDeCobro", e.target.value)}
          required
        />

      </fieldset>
      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={isSaving} disabled={!listo || !seleccionValida}>
          {isSaving ? "Guardando…" : "Guardar suscripción"}
        </Boton>
      </div>
    </form>
  );
}

export default NuevaSuscripcionForm;
