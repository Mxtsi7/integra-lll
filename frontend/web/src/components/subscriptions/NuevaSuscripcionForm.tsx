import React, { useEffect, useState } from "react";
import {
  erroresDesdeServidor,
  parsearMonto,
  validarSuscripcion,
  type CampoSuscripcion,
  type ErroresSuscripcion,
  type Frecuencia,
  type Moneda,
  type Suscripcion,
} from "@ojoalgasto/shared";
import { CampoSelect, CampoTexto } from "../ui/Campo";
import { Boton } from "../ui/Boton";
import { CATEGORIAS, etiquetaFrecuencia } from "./presentacion";
import styles from "./SusForm.module.css";

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: Suscripcion["categoria"];
  fechaDeCobro: string;
  /** Si está en período de prueba gratis (estado "prueba"). */
  enPrueba: boolean;
  finPrueba: string;
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
  monedas?: Moneda[];
  frecuencias?: Frecuencia[];
  /** true mientras el POST está en vuelo: deshabilita el botón de enviar. */
  isSaving?: boolean;
  /** Mensaje general si el guardado falló (sin red, 500…). */
  error?: string | null;
  /**
   * Errores por campo que devolvió el backend (ErrorDeApi.campos). Se
   * muestran junto a su campo (CH-09); los que no son de ningún campo van
   * arriba, con el error general.
   */
  erroresCampos?: Record<string, string[]> | null;
}

const DEFAULT_MONEDAS: Moneda[] = ["CLP", "USD"];
// Solo 'mensual' | 'anual': son los únicos valores que acepta el backend.
const DEFAULT_FRECUENCIAS: Frecuencia[] = ["mensual", "anual"];

const EMPTY_FORM = (monedas: Moneda[], frecuencias: Frecuencia[]): NuevaSuscripcionFormData => ({
  nombre: "",
  monto: "",
  moneda: monedas[0],
  frecuencia: frecuencias[0],
  categoria: "otro",
  fechaDeCobro: "",
  enPrueba: false,
  finPrueba: "",
});

// id de cada control: para llevar el foco al primer campo con error.
const ID_CAMPO: Record<CampoSuscripcion, string> = {
  nombre: "sus-nombre",
  monto: "sus-monto",
  moneda: "sus-moneda",
  frecuencia: "sus-frecuencia",
  fechaProximoCobro: "sus-fecha-cobro",
  finPrueba: "sus-fin-prueba",
};
const ORDEN_CAMPOS = Object.keys(ID_CAMPO) as CampoSuscripcion[];

// Campo de la API → campo del formulario, para los errores del backend.
const CAMPO_DESDE_API: Record<string, CampoSuscripcion> = {
  nombre: "nombre",
  monto: "monto",
  moneda: "moneda",
  frecuencia: "frecuencia",
  fecha_proximo_cobro: "fechaProximoCobro",
  fin_prueba: "finPrueba",
};

function enfocarPrimerError(errores: ErroresSuscripcion) {
  const campo = ORDEN_CAMPOS.find((c) => errores[c]);
  if (campo) document.getElementById(ID_CAMPO[campo])?.focus();
}

export function NuevaSuscripcionForm({
  onAdd,
  onCancel,
  monedas = DEFAULT_MONEDAS,
  frecuencias = DEFAULT_FRECUENCIAS,
  isSaving = false,
  error = null,
  erroresCampos = null,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(EMPTY_FORM(monedas, frecuencias));
  // CH-09: antes había un solo mensaje para todo ("Revisa el nombre y el
  // monto…"). Ahora cada error va junto a su campo.
  const [errores, setErrores] = useState<ErroresSuscripcion>({});
  const [erroresGenerales, setErroresGenerales] = useState<string[]>([]);

  // Cuando llegan errores del backend (la validación definitiva), se
  // reparten por campo y el foco va al primero.
  useEffect(() => {
    if (!erroresCampos) {
      setErroresGenerales([]);
      return;
    }
    const { porCampo, general } = erroresDesdeServidor(erroresCampos, CAMPO_DESDE_API);
    setErrores(porCampo);
    setErroresGenerales(general);
    enfocarPrimerError(porCampo);
  }, [erroresCampos]);

  const handleChange = <K extends keyof NuevaSuscripcionFormData>(field: K, value: NuevaSuscripcionFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Al corregir un campo se borra su error (el de "fin de prueba" también
    // cuando se desmarca la casilla).
    const campo = (field === "fechaDeCobro" ? "fechaProximoCobro" : field === "enPrueba" ? "finPrueba" : field) as
      | CampoSuscripcion
      | "categoria";
    setErrores((prev) => {
      if (campo === "categoria" || !prev[campo]) return prev;
      const { [campo]: _, ...resto } = prev;
      return resto;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;

    const locales = validarSuscripcion({
      nombre: formData.nombre,
      monto: formData.monto,
      moneda: formData.moneda,
      frecuencia: formData.frecuencia,
      fechaProximoCobro: formData.fechaDeCobro,
      enPrueba: formData.enPrueba,
      finPrueba: formData.finPrueba,
    });
    setErrores(locales);
    setErroresGenerales([]);
    // Si algo no cumple (fecha imposible, monto cero o negativo…) no se envía.
    if (Object.keys(locales).length > 0) {
      enfocarPrimerError(locales);
      return;
    }

    const monto = parsearMonto(formData.monto);
    if ("error" in monto) return; // no pasa: validarSuscripcion ya lo revisó

    const exito = await onAdd?.({
      nombre: formData.nombre.trim(),
      monto: monto.valor,
      moneda: formData.moneda,
      frecuencia: formData.frecuencia,
      // La fecha viaja en ISO (YYYY-MM-DD), que es lo que espera la API.
      fecha_proximo_cobro: formData.fechaDeCobro,
      categoria: formData.categoria,
      estado: formData.enPrueba ? "prueba" : "activo",
      ...(formData.enPrueba ? { fin_prueba: formData.finPrueba } : {}),
    });

    // Solo se limpia si el guardado salió bien; si falló, el usuario no
    // pierde lo que ya había escrito.
    if (exito) {
      setFormData(EMPTY_FORM(monedas, frecuencias));
      setErrores({});
    }
  };

  const mensajesArriba = [...(error ? [error] : []), ...erroresGenerales];

  return (
    <form className={styles.formulario} onSubmit={handleSubmit} noValidate>
      {mensajesArriba.length > 0 && (
        <p className={styles.error} role="alert">
          {mensajesArriba.join(" ")}
        </p>
      )}

      <CampoTexto
        id={ID_CAMPO.nombre}
        etiqueta="Servicio"
        type="text"
        placeholder="Netflix, Spotify, el gimnasio…"
        value={formData.nombre}
        onChange={(e) => handleChange("nombre", e.target.value)}
        error={errores.nombre}
        autoFocus
        required
      />

      <div className={styles.filaDoble}>
        {/* Texto con teclado decimal en vez de type="number": acepta la coma
            que se usa en Chile y deja explicar qué está mal (con number el
            navegador vacía el valor y solo se sabría que "falta"). */}
        <CampoTexto
          id={ID_CAMPO.monto}
          etiqueta="Monto"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={formData.monto}
          onChange={(e) => handleChange("monto", e.target.value)}
          error={errores.monto}
          required
        />
        <CampoSelect
          id={ID_CAMPO.moneda}
          etiqueta="Moneda"
          className={styles.moneda}
          value={formData.moneda}
          onChange={(e) => handleChange("moneda", e.target.value as Moneda)}
          error={errores.moneda}
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
          id={ID_CAMPO.frecuencia}
          etiqueta="Se cobra"
          value={formData.frecuencia}
          onChange={(e) => handleChange("frecuencia", e.target.value as Frecuencia)}
          error={errores.frecuencia}
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
          onChange={(e) => handleChange("categoria", e.target.value as Suscripcion["categoria"])}
        >
          {CATEGORIAS.map((c) => (
            <option key={c.valor} value={c.valor}>
              {c.etiqueta}
            </option>
          ))}
        </CampoSelect>
      </div>

      <CampoTexto
        id={ID_CAMPO.fechaProximoCobro}
        etiqueta="Próximo cobro"
        type="date"
        value={formData.fechaDeCobro}
        onChange={(e) => handleChange("fechaDeCobro", e.target.value)}
        error={errores.fechaProximoCobro}
        required
      />

      <label className={styles.casilla}>
        <input
          type="checkbox"
          checked={formData.enPrueba}
          onChange={(e) => handleChange("enPrueba", e.target.checked)}
        />
        <span>Está en período de prueba gratis</span>
      </label>

      {formData.enPrueba && (
        <CampoTexto
          id={ID_CAMPO.finPrueba}
          etiqueta="Termina la prueba"
          type="date"
          ayuda="Te avisamos antes de que empiece a cobrar."
          value={formData.finPrueba}
          onChange={(e) => handleChange("finPrueba", e.target.value)}
          error={errores.finPrueba}
          required
        />
      )}

      <div className={styles.acciones}>
        <Boton variante="secundario" onClick={onCancel} disabled={isSaving}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={isSaving}>
          {isSaving ? "Guardando…" : "Guardar suscripción"}
        </Boton>
      </div>
    </form>
  );
}

export default NuevaSuscripcionForm;
