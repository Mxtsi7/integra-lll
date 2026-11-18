import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ErrorDeApi,
  actualizarSuscripcion,
  erroresDesdeServidor,
  getCatalogosSuscripciones,
  getSuscripcion,
  parsearMonto,
  validarSuscripcion,
  type CampoSuscripcion,
  type CatalogosSuscripciones,
  type ErroresSuscripcion,
  type Frecuencia,
  type Moneda,
  type OpcionesSuscripcion,
  type Suscripcion,
  type SuscripcionPayloadParcial,
} from '@ojoalgasto/shared';
import type { HomeScreenProps } from '../../navigation/types';
import { Loading } from '../../components/estados/Loading';
import { NetworkError } from '../../components/estados/NetworkError';
import { styles } from './SuscripcionNuevaScreen.styles';

export interface EditarSuscripcionFormData {
  id: string;
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: string;
  fechaDeCobro: string;
  enPrueba: boolean;
  finPrueba: string;
}

/** Pasa una suscripción del dominio al estado tipado del formulario de edición. */
export function aFormulario(suscripcion: Suscripcion): EditarSuscripcionFormData {
  return {
    id: suscripcion.id,
    nombre: suscripcion.nombre ?? '',
    monto:
      suscripcion.monto !== undefined && suscripcion.monto !== null
        ? String(suscripcion.monto)
        : '',
    moneda: (suscripcion.moneda ?? '') as Moneda,
    frecuencia: (suscripcion.frecuencia ?? '') as Frecuencia,
    categoria: suscripcion.categoria ?? '',
    fechaDeCobro: suscripcion.fecha_proximo_cobro ?? '',
    enPrueba: suscripcion.estado === 'prueba',
    finPrueba: suscripcion.fin_prueba ?? '',
  };
}

/**
 * Calcula el payload diferencial para PATCH /suscripciones/<id>/ (SE-25).
 * Criterio 1: Solo incluye los campos modificados para no borrar ni alterar
 * campos omitidos en el backend.
 */
export function calcularPatch(
  datos: EditarSuscripcionFormData,
  original: Suscripcion,
): SuscripcionPayloadParcial {
  const patch: SuscripcionPayloadParcial = {};

  if (datos.nombre.trim() !== original.nombre) {
    patch.nombre = datos.nombre.trim();
  }

  const parseado = parsearMonto(datos.monto);
  if ('valor' in parseado && parseado.valor !== Number(original.monto)) {
    patch.monto = parseado.valor;
  }

  if (datos.moneda !== original.moneda) {
    patch.moneda = datos.moneda;
  }

  if (datos.frecuencia !== original.frecuencia) {
    patch.frecuencia = datos.frecuencia;
  }

  if (datos.categoria !== original.categoria) {
    patch.categoria = datos.categoria;
  }

  if (datos.fechaDeCobro !== (original.fecha_proximo_cobro ?? '')) {
    patch.fecha_proximo_cobro = datos.fechaDeCobro;
  }

  // Solo si la suscripción original está en prueba, permite actualizar la fecha fin_prueba.
  // IMPORTANTE: Nunca se envía estado en el PATCH porque services/subscriptions/app/views.py:1081-1093
  // prohíbe modificaciones directas de estado vía PATCH y responde 400.
  if (
    original.estado === 'prueba' &&
    datos.finPrueba &&
    datos.finPrueba !== (original.fin_prueba ?? '')
  ) {
    patch.fin_prueba = datos.finPrueba;
  }

  return patch;
}

export const OPCIONES_POR_DEFECTO: OpcionesSuscripcion = {
  monedas: ['CLP', 'USD', 'EUR'],
  frecuencias: ['mensual', 'anual', 'semanal', 'trimestral', 'semestral'],
  categorias: [
    'streaming',
    'musica',
    'software',
    'salud',
    'educacion',
    'servicios',
    'otros',
  ],
};

const CAMPO_DESDE_API: Record<string, CampoSuscripcion> = {
  nombre: 'nombre',
  monto: 'monto',
  moneda: 'moneda',
  frecuencia: 'frecuencia',
  categoria: 'categoria',
  fecha_proximo_cobro: 'fechaProximoCobro',
  fin_prueba: 'finPrueba',
};

const CAMPO_DEL_ERROR: Record<keyof EditarSuscripcionFormData, CampoSuscripcion | null> = {
  id: null,
  nombre: 'nombre',
  monto: 'monto',
  moneda: 'moneda',
  frecuencia: 'frecuencia',
  categoria: 'categoria',
  fechaDeCobro: 'fechaProximoCobro',
  enPrueba: 'finPrueba',
  finPrueba: 'finPrueba',
};

function mismosDatos(
  actual: EditarSuscripcionFormData,
  inicial: EditarSuscripcionFormData,
): boolean {
  return (Object.keys(inicial) as (keyof EditarSuscripcionFormData)[]).every(
    (campo) => actual[campo] === inicial[campo],
  );
}

export interface EditarSuscripcionFormViewProps {
  suscripcion: Suscripcion;
  catalogos?: CatalogosSuscripciones | null;
  cargandoCatalogos?: boolean;
  errorCatalogo?: string | null;
  onReintentarCatalogos?: () => void;
  opciones?: OpcionesSuscripcion;
  onSubmit?: (datos: EditarSuscripcionFormData) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  isSaving?: boolean;
  errorGeneral?: string | null;
  erroresCampos?: Record<string, string[]> | null;
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
  testID?: string;
}

/**
 * Vista presentacional del formulario móvil de edición de suscripción (SE-24).
 * Precarga valores, permite modificar campos autorizados y cancelar sin alterar datos.
 */
export function EditarSuscripcionFormView({
  suscripcion,
  catalogos,
  cargandoCatalogos = false,
  errorCatalogo = null,
  onReintentarCatalogos,
  opciones: opcionesProp,
  onSubmit,
  onCancel,
  isSaving = false,
  errorGeneral: errorGeneralProp = null,
  erroresCampos = null,
  onCambiosSinGuardar,
  testID = 'screen-suscripcion-editar',
}: EditarSuscripcionFormViewProps) {
  const [prevId, setPrevId] = useState(suscripcion.id);
  const [formData, setFormData] = useState<EditarSuscripcionFormData>(() =>
    aFormulario(suscripcion),
  );
  // Estado inicial inmutable contra el cual contrastar cambios (SE-31 / conservación)
  const [inicial, setInicial] = useState<EditarSuscripcionFormData>(() =>
    aFormulario(suscripcion),
  );

  if (suscripcion.id !== prevId) {
    setPrevId(suscripcion.id);
    const nuevo = aFormulario(suscripcion);
    setFormData(nuevo);
    setInicial(nuevo);
  }

  const hayCambios = useMemo(() => !mismosDatos(formData, inicial), [formData, inicial]);

  useEffect(() => {
    onCambiosSinGuardar?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardar]);

  const [errores, setErrores] = useState<ErroresSuscripcion>({});
  const [erroresGenerales, setErroresGenerales] = useState<string[]>([]);

  // Sincronizar errores desde el servidor (DRF)
  useEffect(() => {
    if (!erroresCampos) {
      setErroresGenerales([]);
      return;
    }
    const { porCampo, general } = erroresDesdeServidor(erroresCampos, CAMPO_DESDE_API);
    setErrores(porCampo);
    setErroresGenerales(general);
  }, [erroresCampos]);

  const monedas = catalogos?.monedas ?? [];
  const categorias = catalogos?.categorias ?? [];
  const frecuencias = catalogos?.frecuencias ?? [];

  // Filtrar activas permitiendo conservar la opción actual si estuviese inactiva (suscripción legada)
  const monedasPermitidas = useMemo(() => {
    if (!catalogos) {
      return (opcionesProp?.monedas ?? OPCIONES_POR_DEFECTO.monedas).map((codigo) => ({
        codigo,
        nombre: codigo,
        activo: true,
      }));
    }
    return monedas.filter((m) => m.activo || m.codigo === suscripcion.moneda);
  }, [catalogos, opcionesProp, suscripcion.moneda, monedas]);

  const categoriasPermitidas = useMemo(() => {
    if (!catalogos) {
      return (opcionesProp?.categorias ?? OPCIONES_POR_DEFECTO.categorias).map((codigo) => ({
        codigo,
        nombre: codigo,
        activo: true,
      }));
    }
    return categorias.filter((c) => c.activo || c.codigo === suscripcion.categoria);
  }, [catalogos, opcionesProp, suscripcion.categoria, categorias]);

  const frecuenciasPermitidas = useMemo(() => {
    if (!catalogos) {
      return (opcionesProp?.frecuencias ?? OPCIONES_POR_DEFECTO.frecuencias).map((codigo) => ({
        codigo,
        nombre: codigo,
      }));
    }
    return frecuencias;
  }, [catalogos, opcionesProp, frecuencias]);

  const opciones = useMemo(
    () => ({
      monedas: monedasPermitidas.map((m) => m.codigo),
      categorias: categoriasPermitidas.map((c) => c.codigo),
      frecuencias: frecuenciasPermitidas.map((f) => f.codigo),
    }),
    [monedasPermitidas, categoriasPermitidas, frecuenciasPermitidas],
  );

  const listo =
    !cargandoCatalogos &&
    !errorCatalogo &&
    monedasPermitidas.length > 0 &&
    categoriasPermitidas.length > 0 &&
    frecuenciasPermitidas.length > 0;

  const seleccionValida =
    monedasPermitidas.some((m) => m.codigo === formData.moneda) &&
    categoriasPermitidas.some((c) => c.codigo === formData.categoria) &&
    frecuenciasPermitidas.some((f) => f.codigo === formData.frecuencia);

  const handleChange = <K extends keyof EditarSuscripcionFormData>(
    campo: K,
    valor: EditarSuscripcionFormData[K],
  ) => {
    setFormData((actual) => ({ ...actual, [campo]: valor }));

    const campoError = CAMPO_DEL_ERROR[campo];
    if (campoError) {
      setErrores((actuales) => {
        if (!actuales[campoError]) return actuales;
        const { [campoError]: _, ...resto } = actuales;
        return resto;
      });
    }
  };

  const handleSubmit = async () => {
    if (!listo || !seleccionValida || isSaving) return;

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

    if (Object.keys(locales).length > 0) {
      return;
    }

    // Se asegura de mantener el id original sin sobrescribir id/tenant
    await onSubmit?.({
      ...formData,
      id: suscripcion.id,
      nombre: formData.nombre.trim(),
    });
  };

  const botonDeshabilitado = isSaving || !listo || !seleccionValida;

  return (
    <View style={styles.safeArea} testID={testID}>
      <KeyboardAvoidingView
        style={styles.keyboardAvoiding}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Encabezado */}
          <View style={styles.header}>
            <Text style={styles.titulo} accessibilityRole="header">
              Editar Suscripción
            </Text>
            <Text style={styles.subtitulo}>
              Modifica los datos de cobro de tu servicio. Los cobros ya pasados no se alteran.
            </Text>
          </View>

          {cargandoCatalogos && (
            <View
              style={styles.estadoCargaCatalogos}
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Cargando opciones"
              accessibilityLiveRegion="polite"
              testID="estado-carga-catalogos"
            >
              <ActivityIndicator size="small" color="#38bdf8" />
              <Text style={styles.textoCargaCatalogos}>Cargando opciones…</Text>
            </View>
          )}

          {errorCatalogo && (
            <View
              style={styles.errorGeneralBox}
              testID="error-catalogo"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.errorGeneralText}>{errorCatalogo}</Text>
              {onReintentarCatalogos && (
                <Pressable
                  testID="btn-reintentar-catalogos"
                  accessibilityRole="button"
                  accessibilityLabel="Reintentar cargar opciones"
                  style={styles.botonReintentarCatalogos}
                  onPress={onReintentarCatalogos}
                >
                  <Text style={styles.botonReintentarCatalogosTexto}>
                    Reintentar opciones
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {errorGeneralProp && (
            <View
              style={styles.errorGeneralBox}
              testID="error-general"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.errorGeneralText}>{errorGeneralProp}</Text>
            </View>
          )}

          {erroresGenerales.length > 0 && (
            <View
              style={styles.errorGeneralBox}
              testID="error-general-api"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              {erroresGenerales.map((msg, i) => (
                <Text key={i} style={styles.errorGeneralText}>
                  {msg}
                </Text>
              ))}
            </View>
          )}

          <View style={styles.card}>
            {/* Campo: Nombre del servicio */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Servicio *</Text>
              <TextInput
                testID="input-nombre"
                style={[styles.input, errores.nombre && styles.inputError]}
                placeholder="Ej: Netflix, Spotify, Gimnasio"
                placeholderTextColor="#64748b"
                value={formData.nombre}
                onChangeText={(texto) => handleChange('nombre', texto)}
                editable={!isSaving}
                accessibilityLabel="Nombre del servicio"
                autoCapitalize="words"
              />
              {errores.nombre && (
                <Text
                  testID="error-nombre"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.nombre}
                </Text>
              )}
            </View>

            {/* Campo: Monto */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Monto *</Text>
              <TextInput
                testID="input-monto"
                style={[styles.input, errores.monto && styles.inputError]}
                placeholder="5990"
                placeholderTextColor="#64748b"
                value={formData.monto}
                onChangeText={(texto) => handleChange('monto', texto)}
                keyboardType="decimal-pad"
                inputMode="decimal"
                editable={!isSaving}
                accessibilityLabel="Monto recurrente"
              />
              {errores.monto && (
                <Text
                  testID="error-monto"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.monto}
                </Text>
              )}
            </View>

            {/* Campo: Moneda */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Moneda *</Text>
              <View
                style={styles.opcionesContenedor}
                accessibilityRole="radiogroup"
                testID="selector-moneda"
              >
                {monedasPermitidas.map((moneda) => {
                  const activa = formData.moneda === moneda.codigo;
                  return (
                    <Pressable
                      key={moneda.codigo}
                      testID={`opcion-moneda-${moneda.codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      aria-selected={activa}
                      accessibilityLabel={`${moneda.nombre || moneda.codigo}${!moneda.activo ? ' (inactiva)' : ''}`}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('moneda', moneda.codigo as Moneda)}
                    >
                      <Text style={[styles.chipTexto, activa && styles.chipTextoActivo]}>
                        {moneda.codigo}
                        {!moneda.activo ? ' (inactiva)' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {errores.moneda && (
                <Text
                  testID="error-moneda"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.moneda}
                </Text>
              )}
            </View>

            {/* Campo: Frecuencia de cobro */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Se cobra *</Text>
              <View
                style={styles.opcionesContenedor}
                accessibilityRole="radiogroup"
                testID="selector-frecuencia"
              >
                {frecuenciasPermitidas.map((frec) => {
                  const activa = formData.frecuencia === frec.codigo;
                  return (
                    <Pressable
                      key={frec.codigo}
                      testID={`opcion-frecuencia-${frec.codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      aria-selected={activa}
                      accessibilityLabel={frec.nombre}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('frecuencia', frec.codigo as Frecuencia)}
                    >
                      <Text style={[styles.chipTexto, activa && styles.chipTextoActivo]}>
                        {frec.nombre}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {errores.frecuencia && (
                <Text
                  testID="error-frecuencia"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.frecuencia}
                </Text>
              )}
            </View>

            {/* Campo: Categoría */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Categoría *</Text>
              <View
                style={styles.opcionesContenedor}
                accessibilityRole="radiogroup"
                testID="selector-categoria"
              >
                {categoriasPermitidas.map((cat) => {
                  const activa = formData.categoria === cat.codigo;
                  return (
                    <Pressable
                      key={cat.codigo}
                      testID={`opcion-categoria-${cat.codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      aria-selected={activa}
                      accessibilityLabel={`${cat.nombre || cat.codigo}${!cat.activo ? ' (inactiva)' : ''}`}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('categoria', cat.codigo)}
                    >
                      <Text style={[styles.chipTexto, activa && styles.chipTextoActivo]}>
                        {cat.nombre || cat.codigo}
                        {!cat.activo ? ' (inactiva)' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {errores.categoria && (
                <Text
                  testID="error-categoria"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.categoria}
                </Text>
              )}
            </View>

            {/* Campo: Próximo Cobro */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Próximo cobro (AAAA-MM-DD) *</Text>
              <TextInput
                testID="input-fecha-cobro"
                style={[styles.input, errores.fechaProximoCobro && styles.inputError]}
                placeholder="2026-11-20"
                placeholderTextColor="#64748b"
                value={formData.fechaDeCobro}
                onChangeText={(texto) => handleChange('fechaDeCobro', texto)}
                editable={!isSaving}
                accessibilityLabel="Fecha del próximo cobro"
                autoCapitalize="none"
              />
              {errores.fechaProximoCobro && (
                <Text
                  testID="error-fecha-cobro"
                  style={styles.errorTexto}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                >
                  {errores.fechaProximoCobro}
                </Text>
              )}
            </View>

            {/* Si la suscripción original está en período de prueba, permite ajustar la fecha de fin de prueba */}
            {formData.enPrueba && (
              <View style={styles.formGroup}>
                <View testID="indicador-en-prueba" style={styles.casillaFila}>
                  <Text style={styles.casillaTexto}>
                    Suscripción en período de prueba gratis
                  </Text>
                </View>
              </View>
            )}

            {/* Campo condicional: Fin de prueba */}
            {formData.enPrueba && (
              <View style={styles.formGroup}>
                <Text style={styles.label}>Termina la prueba (AAAA-MM-DD)</Text>
                <Text style={styles.ayuda}>
                  Te avisamos antes de que empiece a cobrar.
                </Text>
                <TextInput
                  testID="input-fin-prueba"
                  style={[
                    styles.input,
                    errores.finPrueba && styles.inputError,
                  ]}
                  placeholder="2026-12-15"
                  placeholderTextColor="#64748b"
                  value={formData.finPrueba}
                  onChangeText={(texto) => handleChange('finPrueba', texto)}
                  editable={!isSaving}
                  accessibilityLabel="Fecha en que termina la prueba gratis"
                  autoCapitalize="none"
                />
                {errores.finPrueba && (
                  <Text
                    testID="error-fin-prueba"
                    style={styles.errorTexto}
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                  >
                    {errores.finPrueba}
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Botones de acción */}
          <View style={styles.acciones}>
            <Pressable
              testID="btn-guardar-edicion"
              accessibilityRole="button"
              accessibilityLabel="Guardar cambios"
              accessibilityState={{ disabled: botonDeshabilitado, busy: isSaving }}
              disabled={botonDeshabilitado}
              style={[styles.botonGuardar, botonDeshabilitado && styles.botonDeshabilitado]}
              onPress={handleSubmit}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text style={styles.botonGuardarTexto}>Guardar cambios</Text>
              )}
            </Pressable>

            <Pressable
              testID="go-back"
              accessibilityRole="button"
              accessibilityLabel="Cancelar y Volver"
              disabled={isSaving}
              style={[
                styles.chip,
                { minHeight: 44, borderColor: '#475569' },
                isSaving && styles.botonDeshabilitado,
              ]}
              onPress={onCancel}
            >
              <Text style={[styles.chipTexto, { color: '#e2e8f0', fontSize: 15 }]}>
                Cancelar y Volver
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

export interface SuscripcionEditarScreenProps {
  navigation?: HomeScreenProps<'SuscripcionEditar'>['navigation'];
  route?: HomeScreenProps<'SuscripcionEditar'>['route'];
  suscripcion?: Suscripcion;
  onCargarSuscripcion?: (id: string) => Promise<Suscripcion>;
  onCargarCatalogos?: () => Promise<CatalogosSuscripciones>;
  catalogos?: CatalogosSuscripciones | null;
  onActualizarSuscripcion?: (id: string, datos: SuscripcionPayloadParcial) => Promise<Suscripcion>;
  onExito?: (suscripcion: Suscripcion) => void;
  onSubmit?: (datos: EditarSuscripcionFormData) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
}

export default function SuscripcionEditarScreen({
  navigation,
  route,
  suscripcion: suscripcionProp,
  onCargarSuscripcion = getSuscripcion,
  onCargarCatalogos = getCatalogosSuscripciones,
  catalogos: catalogosProp,
  onActualizarSuscripcion = actualizarSuscripcion,
  onExito,
  onSubmit,
  onCancel,
  onCambiosSinGuardar,
}: SuscripcionEditarScreenProps) {
  const id = route?.params?.id ?? suscripcionProp?.id ?? '';
  const [suscripcionActual, setSuscripcionActual] = useState<Suscripcion | null>(
    suscripcionProp ?? route?.params?.suscripcion ?? null,
  );
  const [cargandoSub, setCargandoSub] = useState<boolean>(!suscripcionActual && !!id);
  const [errorSub, setErrorSub] = useState<string | null>(null);

  const [catalogosData, setCatalogosData] = useState<CatalogosSuscripciones | null>(
    catalogosProp ?? null,
  );
  const [cargandoCatalogos, setCargandoCatalogos] = useState<boolean>(catalogosProp === undefined);
  const [errorCatalogo, setErrorCatalogo] = useState<string | null>(null);
  const generacionCatalogoRef = useRef(0);

  const [isSaving, setIsSaving] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [erroresCampos, setErroresCampos] = useState<Record<string, string[]> | null>(null);
  const guardandoRef = useRef(false);

  const cargarCatalogos = useCallback(async () => {
    generacionCatalogoRef.current += 1;
    const generacion = generacionCatalogoRef.current;
    setCargandoCatalogos(true);
    setErrorCatalogo(null);

    try {
      const resp = await onCargarCatalogos();
      if (generacionCatalogoRef.current === generacion) {
        setCatalogosData(resp);
      }
    } catch {
      if (generacionCatalogoRef.current === generacion) {
        setErrorCatalogo('No pudimos cargar las opciones. Intenta de nuevo.');
      }
    } finally {
      if (generacionCatalogoRef.current === generacion) {
        setCargandoCatalogos(false);
      }
    }
  }, [onCargarCatalogos]);

  const cargarSuscripcion = useCallback(
    async (idObjetivo: string) => {
      if (!idObjetivo) {
        setErrorSub('No se especificó la suscripción a editar.');
        return;
      }
      setCargandoSub(true);
      setErrorSub(null);
      try {
        const sub = await onCargarSuscripcion(idObjetivo);
        setSuscripcionActual(sub);
      } catch (err) {
        if (err instanceof ErrorDeApi && err.status === 404) {
          setErrorSub('No encontramos esa suscripción. Puede que haya sido eliminada.');
        } else if (err instanceof ErrorDeApi && err.status === 403) {
          setErrorSub('No tienes permiso para editar esta suscripción.');
        } else {
          setErrorSub('No pudimos cargar la suscripción. Revisa tu conexión e inténtalo de nuevo.');
        }
      } finally {
        setCargandoSub(false);
      }
    },
    [onCargarSuscripcion],
  );

  useEffect(() => {
    if (suscripcionProp) {
      setSuscripcionActual(suscripcionProp);
      setCargandoSub(false);
      return;
    }
    if (route?.params?.suscripcion) {
      setSuscripcionActual(route?.params?.suscripcion);
      setCargandoSub(false);
      return;
    }
    if (id) {
      void cargarSuscripcion(id);
    }
  }, [id, suscripcionProp, route?.params?.suscripcion, cargarSuscripcion]);

  useEffect(() => {
    if (catalogosProp !== undefined) {
      setCatalogosData(catalogosProp);
      setCargandoCatalogos(false);
      return;
    }
    void cargarCatalogos();
    return () => {
      generacionCatalogoRef.current += 1;
    };
  }, [catalogosProp, cargarCatalogos]);

  const manejarCancelar = () => {
    if (onCancel) {
      onCancel();
    } else if (navigation?.goBack) {
      navigation.goBack();
    }
  };

  const handleSubmit = async (datos: EditarSuscripcionFormData): Promise<boolean> => {
    if (onSubmit) {
      const res = await onSubmit(datos);
      return res !== false;
    }

    if (!suscripcionActual) return false;

    if (guardandoRef.current || isSaving) {
      return false;
    }
    guardandoRef.current = true;
    setIsSaving(true);
    setErrorGeneral(null);
    setErroresCampos(null);

    const patch = calcularPatch(datos, suscripcionActual);

    // Si no hubo campos modificados, se evita PATCH redundante y regresa
    if (Object.keys(patch).length === 0) {
      guardandoRef.current = false;
      setIsSaving(false);
      manejarCancelar();
      return true;
    }

    try {
      const actualizada = await onActualizarSuscripcion(suscripcionActual.id, patch);
      onExito?.(actualizada);

      // Conciliar y volver al detalle existente con la suscripción confirmada (React Navigation 7 popTo)
      if (typeof (navigation as any)?.popTo === 'function') {
        (navigation as any).popTo('SuscripcionDetalle', {
          id: actualizada.id,
          suscripcion: actualizada,
        });
      } else if (navigation?.navigate) {
        navigation.navigate('SuscripcionDetalle', {
          id: actualizada.id,
          suscripcion: actualizada,
        });
      } else if (navigation?.goBack) {
        navigation.goBack();
      }

      return true;
    } catch (err: unknown) {
      if (err instanceof ErrorDeApi && err.campos) {
        setErroresCampos(err.campos);
      } else if (err instanceof ErrorDeApi && err.message) {
        setErrorGeneral(err.message);
      } else if (err instanceof TypeError) {
        setErrorGeneral(
          'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
        );
      } else {
        setErrorGeneral('No pudimos actualizar la suscripción. Intenta de nuevo.');
      }
      return false;
    } finally {
      guardandoRef.current = false;
      setIsSaving(false);
    }
  };

  if (cargandoSub) {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-editar">
        <Loading />
      </View>
    );
  }

  if (errorSub || !suscripcionActual) {
    return (
      <View style={styles.safeArea} testID="screen-suscripcion-editar">
        <NetworkError
          mensaje={errorSub ?? 'No pudimos cargar los datos de la suscripción.'}
          onReintentar={() => void cargarSuscripcion(id)}
        />
        <Pressable
          testID="go-back"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          style={[styles.chip, { alignSelf: 'center', marginTop: 12 }]}
          onPress={manejarCancelar}
        >
          <Text style={[styles.chipTexto, { color: '#e2e8f0' }]}>Volver</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <EditarSuscripcionFormView
      testID="screen-suscripcion-editar"
      suscripcion={suscripcionActual}
      catalogos={catalogosData}
      cargandoCatalogos={cargandoCatalogos}
      errorCatalogo={errorCatalogo}
      onReintentarCatalogos={cargarCatalogos}
      onSubmit={handleSubmit}
      onCancel={manejarCancelar}
      isSaving={isSaving}
      errorGeneral={errorGeneral}
      erroresCampos={erroresCampos}
      onCambiosSinGuardar={onCambiosSinGuardar}
    />
  );
}
