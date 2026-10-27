import React, { useEffect, useState } from "react";
import {
  erroresDesdeServidor,
  parsearMonto,
  validarSuscripcion,
  type CampoSuscripcion,
  type CatalogosSuscripciones,
  type ErroresSuscripcion,
  type Frecuencia,
  type Moneda,
  type OpcionesSuscripcion,
  type Suscripcion,
} from "@ojoalgasto/shared";
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
  /**
   * Avisa si el formulario tiene cambios sin guardar respecto del estado
   * vacío (CH-16). Lo usa Homepage para preguntar antes de cerrar.
   */
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
}

const EMPTY_FORM = (): NuevaSuscripcionFormData => ({
  nombre: "",
  monto: "",
  moneda: "",
  frecuencia: "" as Frecuencia,
  categoria: "",
  fechaDeCobro: "",
  enPrueba: false,
  finPrueba: "",
});

/**
 * El formulario "sin tocar": vacío, pero con la moneda, la categoría y la
 * frecuencia que propone el catálogo. Es con lo que se compara para saber
 * si hay cambios sin guardar (CH-16): que el catálogo complete esos campos
 * al cargar no cuenta como un cambio del usuario.
 */
function formularioInicial(
  predeterminados?: CatalogosSuscripciones["predeterminados"],
): NuevaSuscripcionFormData {
  return {
    ...EMPTY_FORM(),
    moneda: predeterminados?.moneda ?? "",
    categoria: predeterminados?.categoria ?? "",
    frecuencia: predeterminados?.frecuencia ?? ("" as Frecuencia),
  };
}

// id de cada control: para llevar el foco al primer campo con error.
const ID_CAMPO: Record<CampoSuscripcion, string> = {
  nombre: "sus-nombre",
  monto: "sus-monto",
  moneda: "sus-moneda",
  frecuencia: "sus-frecuencia",
  categoria: "sus-categoria",
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
  categoria: "categoria",
  fecha_proximo_cobro: "fechaProximoCobro",
  fin_prueba: "finPrueba",
};

// Campo del formulario → campo cuyo error se borra al editarlo.
const CAMPO_DEL_ERROR: Record<keyof NuevaSuscripcionFormData, CampoSuscripcion> = {
  nombre: "nombre",
  monto: "monto",
  moneda: "moneda",
  frecuencia: "frecuencia",
  categoria: "categoria",
  fechaDeCobro: "fechaProximoCobro",
  // Desmarcar la casilla también borra el error de "fin de prueba".
  enPrueba: "finPrueba",
  finPrueba: "finPrueba",
};

function mismosDatos(a: NuevaSuscripcionFormData, b: NuevaSuscripcionFormData): boolean {
  return (Object.keys(a) as (keyof NuevaSuscripcionFormData)[]).every((k) => a[k] === b[k]);
}

function enfocarPrimerError(errores: ErroresSuscripcion) {
  const campo = ORDEN_CAMPOS.find((c) => errores[c]);
  if (campo) document.getElementById(ID_CAMPO[campo])?.focus();
}

export function NuevaSuscripcionForm({
  onAdd,
  onCancel,
  isSaving = false,
  error = null,
  erroresCampos = null,
  onCambiosSinGuardar,
}: NuevaSuscripcionFormProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(EMPTY_FORM());

  // Monedas, categorías y frecuencias vienen del catálogo del backend.
  const { datos, cargando, error: errorCatalogo } = useCatalogos();
  const monedas = datos?.monedas ?? [];
  const categorias = datos?.categorias ?? [];
  const frecuencias = datos?.frecuencias ?? [];
  // Lo que hoy se puede elegir: solo opciones activas.
  const opciones: OpcionesSuscripcion = {
    monedas: monedas.filter((o) => o.activo).map((o) => o.codigo),
    categorias: categorias.filter((o) => o.activo).map((o) => o.codigo),
    frecuencias: frecuencias.map((o) => o.codigo),
  };
  const listo = !!datos && !cargando && !errorCatalogo
    && opciones.monedas.length > 0 && opciones.categorias.length > 0 && opciones.frecuencias.length > 0;
  const seleccionValida = opciones.monedas.includes(formData.moneda)
    && opciones.categorias.includes(formData.categoria)
    && opciones.frecuencias.includes(formData.frecuencia);

  // Al llegar el catálogo se completan sus valores por defecto, sin pisar lo
  // que el usuario ya eligió.
  useEffect(() => {
    if (!datos) return;
    setFormData((actual) => ({ ...actual,
      moneda: actual.moneda || datos.predeterminados.moneda || '',
      categoria: actual.categoria || datos.predeterminados.categoria || '',
      frecuencia: actual.frecuencia || datos.predeterminados.frecuencia,
    }));
  }, [datos]);

  // CH-16: hay cambios si algo difiere del formulario sin tocar. Volver a
  // dejar un campo como estaba cuenta como "sin cambios". Mientras el efecto
  // de arriba no completa los valores por defecto, un campo vacío se toma
  // como su valor por defecto: así ni por un render parece que hay cambios.
  const inicial = formularioInicial(datos?.predeterminados);
  const hayCambios = !mismosDatos(
    {
      ...formData,
      moneda: formData.moneda || inicial.moneda,
      categoria: formData.categoria || inicial.categoria,
      frecuencia: formData.frecuencia || inicial.frecuencia,
    },
    inicial,
  );
  useEffect(() => {
    onCambiosSinGuardar?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardar]);

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
    // Al corregir un campo se borra su error.
    const campo = CAMPO_DEL_ERROR[field];
    setErrores((prev) => {
      if (!prev[campo]) return prev;
      const { [campo]: _, ...resto } = prev;
      return resto;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Sin catálogo no hay opciones con qué validar ni enviar.
    if (!listo || isSaving) return;

    const locales = validarSuscripcion(
      {
        nombre: formData.nombre,
        monto: formData.monto,
        moneda: formData.moneda,
        categoria: formData.categoria,
        frecuencia: formData.frecuencia,
        fechaProximoCobro: formData.fechaDeCobro,
        enPrueba: formData.enPrueba,
        finPrueba: formData.finPrueba,
      },
      opciones,
    );
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
      setFormData(formularioInicial(datos?.predeterminados));
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

      <EstadoCargaCatalogos sinOpciones={!!datos && !listo} />
      <fieldset disabled={isSaving || !listo} className={styles.campos}>
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
            onChange={(e) => handleChange("moneda", e.target.value)}
            error={errores.moneda}
          >
            {!opciones.monedas.includes(formData.moneda) && <option value={formData.moneda}>Selecciona una moneda</option>}
            {monedas.filter((o) => o.activo).map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nombre} ({m.codigo})
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
            {!formData.frecuencia && <option value="">Selecciona frecuencia</option>}
            {frecuencias.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nombre}
              </option>
            ))}
          </CampoSelect>
          <CampoSelect
            id={ID_CAMPO.categoria}
            etiqueta="Categoría"
            value={formData.categoria}
            onChange={(e) => handleChange("categoria", e.target.value)}
            error={errores.categoria}
          >
            {!opciones.categorias.includes(formData.categoria) && <option value={formData.categoria}>Selecciona una categoría</option>}
            {categorias.filter((o) => o.activo).map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.nombre}
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
