import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  ErrorDeApi,
  erroresDesdeServidor,
  formatearFecha,
  hoyEnTexto,
  validarUso,
  type CampoUso,
  type ErroresUso,
  type Suscripcion,
} from '@ojoalgasto/shared';

export interface RegistrarUsoFormMovilProps {
  idSuscripcion: string;
  nombreSuscripcion?: string;
  onRegistrar: (minutos: number, fecha?: string) => Promise<Suscripcion>;
  onExito?: (suscripcionActualizada: Suscripcion) => void;
  onCancelar?: () => void;
  bloqueado?: boolean;
  sigueVigente?: () => boolean;
}

const CAMPO_DESDE_API: Record<string, CampoUso> = {
  minutos: 'minutos',
  fecha: 'fecha',
};

function formatoMinutos(minutos: number): string {
  return minutos === 1 ? '1 minuto' : `${minutos.toLocaleString('es-CL')} minutos`;
}

function textoConfirmacion(minutos: number, fecha: string | undefined, hoy: string): string {
  if (!fecha || fecha.slice(0, 7) === hoy.slice(0, 7)) {
    return `Registraste ${formatoMinutos(minutos)}.`;
  }
  return `Registraste ${formatoMinutos(minutos)} el ${formatearFecha(fecha)}. No suma a las horas de este mes.`;
}

export function RegistrarUsoFormMovil({
  idSuscripcion: _idSuscripcion,
  nombreSuscripcion: _nombreSuscripcion,
  onRegistrar,
  onExito,
  onCancelar,
  bloqueado = false,
  sigueVigente = () => true,
}: RegistrarUsoFormMovilProps) {
  const hoy = hoyEnTexto();
  const [minutos, setMinutos] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [errores, setErrores] = useState<ErroresUso>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [confirmacion, setConfirmacion] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviandoRef = useRef(false);

  const handleSubmit = async () => {
    // Un doble tap no registra dos veces el mismo uso
    if (enviandoRef.current || bloqueado || !sigueVigente()) return;

    const fechaLimpia = fecha.trim();
    const locales = validarUso({ minutos, fecha: fechaLimpia }, hoy);
    setErrores(locales);
    setErrorGeneral(null);
    setConfirmacion(null);

    // Si hay errores locales de validación, no se envía nada al servidor
    if (locales.minutos || locales.fecha) {
      return;
    }

    const cantidad = Number(minutos.trim());
    // "Día" vacío o sin fecha no viaja como fecha: "" (el serializer lo rechaza);
    // se omite y el backend usa hoy
    const fechaAEnviar = fechaLimpia ? fechaLimpia : undefined;

    enviandoRef.current = true;
    setGuardando(true);

    try {
      const actualizada = await onRegistrar(cantidad, fechaAEnviar);
      if (!sigueVigente()) return;
      setMinutos('');
      setConfirmacion(textoConfirmacion(cantidad, fechaAEnviar, hoy));
      onExito?.(actualizada);
    } catch (err: unknown) {
      if (!sigueVigente()) return;
      if (err instanceof ErrorDeApi && err.campos) {
        const { porCampo, general } = erroresDesdeServidor(err.campos, CAMPO_DESDE_API);
        setErrores(porCampo);
        if (general.length > 0) setErrorGeneral(general.join(' '));
      } else if (err instanceof ErrorDeApi) {
        setErrorGeneral(err.message);
      } else if (err instanceof TypeError) {
        setErrorGeneral('No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
      } else {
        setErrorGeneral('No pudimos registrar el uso. Intenta de nuevo.');
      }
    } finally {
      enviandoRef.current = false;
      if (sigueVigente()) {
        setGuardando(false);
      }
    }
  };

  const estaDeshabilitado = guardando || bloqueado;

  return (
    <View style={styles.contenedor} testID="form-registrar-uso">
      {errorGeneral && (
        <View
          style={styles.errorGeneralBox}
          testID="error-general"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.errorGeneralText}>{errorGeneral}</Text>
        </View>
      )}

      {/* Campo Minutos */}
      <View style={styles.campoGrupo}>
        <Text style={styles.label}>Minutos de uso</Text>
        <TextInput
          testID="input-minutos"
          style={[styles.input, errores.minutos && styles.inputError]}
          placeholder="Ej: 45"
          placeholderTextColor="#64748b"
          keyboardType="numeric"
          inputMode="numeric"
          value={minutos}
          editable={!estaDeshabilitado}
          accessibilityLabel="Minutos de uso"
          aria-invalid={errores.minutos ? 'true' : undefined}
          onChangeText={(texto) => {
            setMinutos(texto);
            setErrores((act) => ({ ...act, minutos: undefined }));
            setConfirmacion(null);
          }}
        />
        {errores.minutos && (
          <Text
            testID="error-minutos"
            style={styles.errorTexto}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {errores.minutos}
          </Text>
        )}
      </View>

      {/* Campo Fecha */}
      <View style={styles.campoGrupo}>
        <Text style={styles.label}>Fecha</Text>
        <TextInput
          testID="input-fecha"
          style={[styles.input, errores.fecha && styles.inputError]}
          placeholder="AAAA-MM-DD"
          placeholderTextColor="#64748b"
          value={fecha}
          editable={!estaDeshabilitado}
          accessibilityLabel="Fecha de uso"
          aria-invalid={errores.fecha ? 'true' : undefined}
          onChangeText={(texto) => {
            setFecha(texto);
            setErrores((act) => ({ ...act, fecha: undefined }));
            setConfirmacion(null);
          }}
        />
        {errores.fecha && (
          <Text
            testID="error-fecha"
            style={styles.errorTexto}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            {errores.fecha}
          </Text>
        )}
      </View>

      {confirmacion && (
        <View style={styles.confirmacionBox}>
          <Text
            testID="confirmacion-uso"
            style={styles.confirmacionTexto}
            accessibilityRole={'status' as any}
            accessibilityLiveRegion="polite"
          >
            {confirmacion}
          </Text>
        </View>
      )}

      <View style={styles.accionesFila}>
        {onCancelar && (
          <Pressable
            testID="btn-cancelar-uso"
            accessibilityRole="button"
            accessibilityLabel="Cancelar registro de uso"
            style={[styles.boton, styles.botonSecundario]}
            disabled={guardando}
            accessibilityState={{ disabled: guardando }}
            onPress={onCancelar}
          >
            <Text style={styles.botonSecundarioTexto}>Cancelar</Text>
          </Pressable>
        )}

        <Pressable
          testID="btn-submit-uso"
          accessibilityRole="button"
          accessibilityLabel={guardando ? 'Registrando uso' : 'Registrar uso'}
          disabled={estaDeshabilitado}
          accessibilityState={{ disabled: estaDeshabilitado }}
          style={[
            styles.boton,
            styles.botonPrimario,
            estaDeshabilitado && styles.botonDeshabilitado,
          ]}
          onPress={handleSubmit}
        >
          {guardando ? (
            <View style={styles.cargandoFila}>
              <ActivityIndicator size="small" color="#0f172a" />
              <Text style={styles.botonPrimarioTexto}>Registrando…</Text>
            </View>
          ) : (
            <Text style={styles.botonPrimarioTexto}>Registrar uso</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    width: '100%',
  },
  campoGrupo: {
    marginBottom: 16,
  },
  label: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 15,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorTexto: {
    color: '#fca5a5',
    fontSize: 12,
    marginTop: 4,
  },
  errorGeneralBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  errorGeneralText: {
    color: '#fca5a5',
    fontSize: 13,
    lineHeight: 18,
  },
  confirmacionBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  confirmacionTexto: {
    color: '#6ee7b7',
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  accionesFila: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  boton: {
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  botonPrimario: {
    backgroundColor: '#38bdf8',
    flex: 1,
  },
  botonPrimarioTexto: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: '700',
  },
  botonSecundario: {
    backgroundColor: '#334155',
    flex: 1,
  },
  botonSecundarioTexto: {
    color: '#e2e8f0',
    fontSize: 15,
    fontWeight: '600',
  },
  botonDeshabilitado: {
    opacity: 0.6,
  },
  cargandoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
