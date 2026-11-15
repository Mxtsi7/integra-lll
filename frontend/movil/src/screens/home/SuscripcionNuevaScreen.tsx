import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  crearSuscripcion,
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
  type SuscripcionPayload,
} from '@ojoalgasto/shared';
import type { HomeScreenProps } from '../../navigation/types';
import { styles } from './SuscripcionNuevaScreen.styles';

export interface NuevaSuscripcionFormData {
  nombre: string;
  monto: string;
  moneda: Moneda;
  frecuencia: Frecuencia;
  categoria: string;
  fechaDeCobro: string;
  enPrueba: boolean;
  finPrueba: string;
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

const EMPTY_FORM = (): NuevaSuscripcionFormData => ({
  nombre: '',
  monto: '',
  moneda: 'CLP',
  frecuencia: 'mensual',
  categoria: 'streaming',
  fechaDeCobro: '',
  enPrueba: false,
  finPrueba: '',
});

function formularioInicial(
  predeterminados?: CatalogosSuscripciones['predeterminados'],
): NuevaSuscripcionFormData {
  return {
    ...EMPTY_FORM(),
    moneda: (predeterminados?.moneda as Moneda) || 'CLP',
    categoria: predeterminados?.categoria || 'streaming',
    frecuencia: predeterminados?.frecuencia || 'mensual',
  };
}

const CAMPO_DESDE_API: Record<string, CampoSuscripcion> = {
  nombre: 'nombre',
  monto: 'monto',
  moneda: 'moneda',
  frecuencia: 'frecuencia',
  categoria: 'categoria',
  fecha_proximo_cobro: 'fechaProximoCobro',
  fin_prueba: 'finPrueba',
};

const CAMPO_DEL_ERROR: Record<keyof NuevaSuscripcionFormData, CampoSuscripcion> = {
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
  actual: NuevaSuscripcionFormData,
  inicial: NuevaSuscripcionFormData,
): boolean {
  return (Object.keys(actual) as (keyof NuevaSuscripcionFormData)[]).every(
    (campo) => actual[campo] === inicial[campo],
  );
}

export interface NuevaSuscripcionFormViewProps {
  catalogos?: CatalogosSuscripciones | null;
  opciones?: OpcionesSuscripcion;
  onSubmit?: (datos: SuscripcionPayload) => Promise<boolean | void> | boolean | void;
  onCancel?: () => void;
  isSaving?: boolean;
  errorGeneral?: string | null;
  erroresCampos?: Record<string, string[]> | null;
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
  testID?: string;
}

/**
 * Vista presentacional del formulario móvil de nueva suscripción (SE-22).
 * Maneja estado desacoplado, validación por campo, conservación de datos
 * y accesibilidad para teclado y lectores de pantalla.
 */
export function NuevaSuscripcionFormView({
  catalogos,
  opciones: opcionesProp,
  onSubmit,
  onCancel,
  isSaving = false,
  errorGeneral = null,
  erroresCampos = null,
  onCambiosSinGuardar,
  testID = 'screen-suscripcion-nueva',
}: NuevaSuscripcionFormViewProps) {
  const [formData, setFormData] = useState<NuevaSuscripcionFormData>(() =>
    formularioInicial(catalogos?.predeterminados),
  );
  const [errores, setErrores] = useState<ErroresSuscripcion>({});
  const [erroresServidorGenerales, setErroresServidorGenerales] = useState<string[]>([]);

  // Opciones combinadas: catálogo dinámico o catálogo predeterminado
  const opciones: OpcionesSuscripcion = useMemo(() => {
    if (opcionesProp) return opcionesProp;
    if (catalogos) {
      return {
        monedas: catalogos.monedas.filter((m) => m.activo).map((m) => m.codigo),
        categorias: catalogos.categorias.filter((c) => c.activo).map((c) => c.codigo),
        frecuencias: catalogos.frecuencias.map((f) => f.codigo),
      };
    }
    return OPCIONES_POR_DEFECTO;
  }, [catalogos, opcionesProp]);

  // Si llegan predeterminados de un catálogo posterior, inicializar si no se ha modificado
  useEffect(() => {
    if (!catalogos?.predeterminados) return;
    setFormData((actual) => ({
      ...actual,
      moneda: actual.moneda || (catalogos.predeterminados.moneda as Moneda) || 'CLP',
      categoria: actual.categoria || catalogos.predeterminados.categoria || 'streaming',
      frecuencia: actual.frecuencia || catalogos.predeterminados.frecuencia || 'mensual',
    }));
  }, [catalogos]);

  // Manejo de errores devueltos por el servidor (API)
  useEffect(() => {
    if (!erroresCampos) {
      setErroresServidorGenerales([]);
      return;
    }
    const { porCampo, general } = erroresDesdeServidor(erroresCampos, CAMPO_DESDE_API);
    setErrores((prev) => ({ ...prev, ...porCampo }));
    setErroresServidorGenerales(general);
  }, [erroresCampos]);

  // Detección de cambios sin guardar respecto del estado inicial (para SE-31)
  const inicial = useMemo(
    () => formularioInicial(catalogos?.predeterminados),
    [catalogos],
  );
  const hayCambios = !mismosDatos(formData, inicial);

  useEffect(() => {
    onCambiosSinGuardar?.(hayCambios);
  }, [hayCambios, onCambiosSinGuardar]);

  const handleChange = <K extends keyof NuevaSuscripcionFormData>(
    campo: K,
    valor: NuevaSuscripcionFormData[K],
  ) => {
    setFormData((prev) => ({ ...prev, [campo]: valor }));

    // Al modificar un campo se limpia de inmediato su error
    const campoError = CAMPO_DEL_ERROR[campo];
    setErrores((prev) => {
      if (!prev[campoError]) return prev;
      const copia = { ...prev };
      delete copia[campoError];
      return copia;
    });
  };

  const handleSubmit = async () => {
    if (isSaving) return;

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
    setErroresServidorGenerales([]);

    if (Object.keys(locales).length > 0) {
      return;
    }

    const montoParseado = parsearMonto(formData.monto);
    if ('error' in montoParseado) {
      setErrores((prev) => ({ ...prev, monto: montoParseado.error }));
      return;
    }

    const payload: SuscripcionPayload = {
      nombre: formData.nombre.trim(),
      monto: montoParseado.valor,
      moneda: formData.moneda,
      frecuencia: formData.frecuencia,
      fecha_proximo_cobro: formData.fechaDeCobro,
      categoria: formData.categoria,
      estado: formData.enPrueba ? 'prueba' : 'activo',
      ...(formData.enPrueba ? { fin_prueba: formData.finPrueba } : {}),
    };

    try {
      const resultado = await onSubmit?.(payload);
      // Solo se resetea si el guardado explícitamente tuvo éxito
      if (resultado !== false) {
        setFormData(formularioInicial(catalogos?.predeterminados));
        setErrores({});
      }
    } catch {
      // Si falla la promesa, los valores tipeados NO se pierden
    }
  };

  const mensajesSuperiores = [
    ...(errorGeneral ? [errorGeneral] : []),
    ...erroresServidorGenerales,
  ];

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
          <View style={styles.header}>
            <Text style={styles.titulo} accessibilityRole="header">
              Nueva Suscripción
            </Text>
            <Text style={styles.subtitulo}>
              Registra un servicio recurrente para controlar tus gastos y alertas.
            </Text>
          </View>

          {mensajesSuperiores.length > 0 && (
            <View
              style={styles.errorGeneralBox}
              testID="error-general"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
            >
              <Text style={styles.errorGeneralText}>
                {mensajesSuperiores.join(' ')}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            {/* Campo: Nombre */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Servicio</Text>
              <TextInput
                testID="input-nombre"
                style={[styles.input, errores.nombre && styles.inputError]}
                placeholder="Netflix, Spotify, el gimnasio…"
                placeholderTextColor="#64748b"
                value={formData.nombre}
                onChangeText={(texto) => handleChange('nombre', texto)}
                editable={!isSaving}
                accessibilityLabel="Nombre del servicio"
                autoCapitalize="sentences"
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
              <Text style={styles.label}>Monto</Text>
              <TextInput
                testID="input-monto"
                style={[styles.input, errores.monto && styles.inputError]}
                inputMode="decimal"
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor="#64748b"
                value={formData.monto}
                onChangeText={(texto) => handleChange('monto', texto)}
                editable={!isSaving}
                accessibilityLabel="Monto a pagar"
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
              <Text style={styles.label}>Moneda</Text>
              <View style={styles.opcionesContenedor} testID="selector-moneda">
                {opciones.monedas.map((codigo) => {
                  const activa = formData.moneda === codigo;
                  return (
                    <Pressable
                      key={codigo}
                      testID={`opcion-moneda-${codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      accessibilityLabel={`Moneda ${codigo}`}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('moneda', codigo as Moneda)}
                    >
                      <Text
                        style={[
                          styles.chipTexto,
                          activa && styles.chipTextoActivo,
                        ]}
                      >
                        {codigo}
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

            {/* Campo: Frecuencia */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Se cobra</Text>
              <View style={styles.opcionesContenedor} testID="selector-frecuencia">
                {opciones.frecuencias.map((codigo) => {
                  const activa = formData.frecuencia === codigo;
                  return (
                    <Pressable
                      key={codigo}
                      testID={`opcion-frecuencia-${codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      accessibilityLabel={`Frecuencia ${codigo}`}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('frecuencia', codigo as Frecuencia)}
                    >
                      <Text
                        style={[
                          styles.chipTexto,
                          activa && styles.chipTextoActivo,
                        ]}
                      >
                        {codigo}
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
              <Text style={styles.label}>Categoría</Text>
              <View style={styles.opcionesContenedor} testID="selector-categoria">
                {opciones.categorias.map((codigo) => {
                  const activa = formData.categoria === codigo;
                  return (
                    <Pressable
                      key={codigo}
                      testID={`opcion-categoria-${codigo}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: activa }}
                      accessibilityLabel={`Categoría ${codigo}`}
                      disabled={isSaving}
                      style={[styles.chip, activa && styles.chipActivo]}
                      onPress={() => handleChange('categoria', codigo)}
                    >
                      <Text
                        style={[
                          styles.chipTexto,
                          activa && styles.chipTextoActivo,
                        ]}
                      >
                        {codigo}
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

            {/* Campo: Fecha de próximo cobro */}
            <View style={styles.formGroup}>
              <Text style={styles.label}>Próximo cobro (AAAA-MM-DD)</Text>
              <TextInput
                testID="input-fecha-cobro"
                style={[
                  styles.input,
                  errores.fechaProximoCobro && styles.inputError,
                ]}
                placeholder="2026-12-01"
                placeholderTextColor="#64748b"
                value={formData.fechaDeCobro}
                onChangeText={(texto) => handleChange('fechaDeCobro', texto)}
                editable={!isSaving}
                accessibilityLabel="Fecha de próximo cobro"
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

            {/* Casilla: Periodo de prueba gratis */}
            <Pressable
              testID="checkbox-en-prueba"
              accessibilityRole="checkbox"
              accessibilityState={{ checked: formData.enPrueba }}
              accessibilityLabel="Está en período de prueba gratis"
              disabled={isSaving}
              style={styles.casillaFila}
              onPress={() => handleChange('enPrueba', !formData.enPrueba)}
            >
              <View
                style={[
                  styles.checkbox,
                  formData.enPrueba && styles.checkboxActivo,
                ]}
              >
                {formData.enPrueba && <Text style={styles.checkboxCheck}>✓</Text>}
              </View>
              <Text style={styles.casillaTexto}>
                Está en período de prueba gratis
              </Text>
            </Pressable>

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
              testID="btn-guardar-suscripcion"
              accessibilityRole="button"
              accessibilityLabel="Guardar suscripción"
              accessibilityState={{ disabled: isSaving, busy: isSaving }}
              disabled={isSaving}
              style={[styles.botonGuardar, isSaving && styles.botonDeshabilitado]}
              onPress={handleSubmit}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#0f172a" />
              ) : (
                <Text style={styles.botonGuardarTexto}>Guardar suscripción</Text>
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

export interface SuscripcionNuevaScreenProps {
  navigation?: HomeScreenProps<'SuscripcionNueva'>['navigation'];
  onCrearSuscripcion?: (datos: SuscripcionPayload) => Promise<Suscripcion>;
  catalogos?: CatalogosSuscripciones | null;
  onExito?: (suscripcion: Suscripcion) => void;
  onCambiosSinGuardar?: (hayCambios: boolean) => void;
}

export default function SuscripcionNuevaScreen({
  navigation,
  onCrearSuscripcion = crearSuscripcion,
  catalogos,
  onExito,
  onCambiosSinGuardar,
}: SuscripcionNuevaScreenProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [erroresCampos, setErroresCampos] = useState<Record<string, string[]> | null>(null);
  const guardandoRef = useRef(false);

  const handleSubmit = async (datos: SuscripcionPayload): Promise<boolean> => {
    // Bloqueo de doble envío concurrente (antirrebote sincrónico y reactivo)
    if (guardandoRef.current || isSaving) {
      return false;
    }
    guardandoRef.current = true;
    setIsSaving(true);
    setErrorGeneral(null);
    setErroresCampos(null);

    try {
      const creada = await onCrearSuscripcion(datos);
      onExito?.(creada);

      // Navegar al resultado (detalle de la nueva suscripción)
      if (navigation?.replace) {
        navigation.replace('SuscripcionDetalle', { id: creada.id });
      } else if (navigation?.navigate) {
        navigation.navigate('SuscripcionDetalle', { id: creada.id });
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
        setErrorGeneral('No pudimos crear la suscripción. Intenta de nuevo.');
      }
      return false;
    } finally {
      guardandoRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <NuevaSuscripcionFormView
      testID="screen-suscripcion-nueva"
      catalogos={catalogos}
      onSubmit={handleSubmit}
      onCancel={() => {
        if (navigation?.goBack) {
          navigation.goBack();
        }
      }}
      isSaving={isSaving}
      errorGeneral={errorGeneral}
      erroresCampos={erroresCampos}
      onCambiosSinGuardar={onCambiosSinGuardar}
    />
  );
}
