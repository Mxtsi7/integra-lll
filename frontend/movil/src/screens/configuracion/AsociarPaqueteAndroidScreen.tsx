import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getSuscripciones, type Suscripcion } from '@ojoalgasto/shared';
import { NavButton } from '../components/NavButton';
import { controlAsociacionPaquetes } from '../../services/usoAndroidAsociacion';
import type { AsociacionPaquete } from '../../services/asociacionPaquetes';

export default function AsociarPaqueteAndroidScreen() {
  const [suscripciones, setSuscripciones] = useState<Suscripcion[]>([]);
  const [asociaciones, setAsociaciones] = useState<AsociacionPaquete[]>([]);
  const [suscripcionSeleccionada, setSuscripcionSeleccionada] = useState<string | null>(null);
  const [paquete, setPaquete] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [suscripcionesPropias, asociacionesGuardadas] = await Promise.all([
        getSuscripciones(),
        controlAsociacionPaquetes.listar(),
      ]);
      setSuscripciones(suscripcionesPropias);
      setAsociaciones(asociacionesGuardadas);
    } catch {
      setError('No se pudieron cargar tus suscripciones o asociaciones. Comprueba la conexión e inténtalo de nuevo.');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => { void Promise.resolve().then(cargar); }, [cargar]);

  const guardarAsociacion = async () => {
    if (!suscripcionSeleccionada) {
      setError('Selecciona primero una suscripción.');
      return;
    }
    setCargando(true);
    setError(null);
    try {
      await controlAsociacionPaquetes.asociar(suscripcionSeleccionada, paquete);
      setPaquete('');
      setSuscripcionSeleccionada(null);
      await cargar();
    } catch (errorAsociacion) {
      setError(errorAsociacion instanceof Error ? errorAsociacion.message : 'No se pudo guardar la asociación.');
      setCargando(false);
    }
  };

  const quitarAsociacion = async (paqueteAsociado: string) => {
    setError(null);
    try {
      await controlAsociacionPaquetes.quitar(paqueteAsociado);
      setAsociaciones(await controlAsociacionPaquetes.listar());
    } catch {
      setError('No se pudo quitar la asociación. Inténtalo de nuevo.');
    }
  };

  return (
    <ScrollView testID="screen-asociar-paquete-android" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Asociar paquete Android</Text>
      <Text style={styles.texto}>
        Elige una suscripción y escribe el nombre de paquete exacto, por ejemplo com.ejemplo.app.
        La asociación se guarda cifrada en este dispositivo y queda vinculada a tu sesión.
      </Text>
      <Text style={styles.texto}>
        Esta configuración no consulta aplicaciones instaladas ni inicia captura de uso. El consentimiento
        vigente y el permiso del sistema siguen siendo requisitos independientes.
      </Text>

      <Text style={styles.subtitulo}>Tus suscripciones</Text>
      {cargando ? <Text testID="cargando-asociaciones">Cargando…</Text> : null}
      {!cargando && suscripciones.length === 0 ? <Text>No hay suscripciones disponibles.</Text> : null}
      {suscripciones.map((suscripcion) => (
        <View key={suscripcion.id} style={styles.filaSuscripcion}>
          <Text style={styles.nombre}>{suscripcion.nombre}</Text>
          <Text style={styles.paqueteActual}>
            {asociaciones.filter((asociacion) => asociacion.suscripcionId === suscripcion.id)
              .map((asociacion) => asociacion.paquete).join(', ') || 'Sin paquete asociado'}
          </Text>
          <NavButton
            testID={`seleccionar-suscripcion-${suscripcion.id}`}
            title={suscripcionSeleccionada === suscripcion.id ? 'Seleccionada' : 'Elegir suscripción'}
            variant="secondary"
            disabled={cargando}
            onPress={() => { setError(null); setSuscripcionSeleccionada(suscripcion.id); }}
          />
        </View>
      ))}

      {suscripcionSeleccionada ? (
        <View style={styles.formulario}>
          <Text>Paquete para {suscripciones.find(({ id }) => id === suscripcionSeleccionada)?.nombre}</Text>
          <TextInput
            testID="entrada-paquete-android"
            accessibilityLabel="Nombre de paquete Android"
            autoCapitalize="none"
            autoCorrect={false}
            value={paquete}
            onChangeText={setPaquete}
            placeholder="com.ejemplo.app"
            style={styles.entrada}
          />
          <NavButton
            testID="guardar-asociacion-paquete"
            title="Guardar asociación"
            disabled={cargando || !paquete.trim()}
            onPress={() => void guardarAsociacion()}
          />
        </View>
      ) : null}

      {asociaciones.map((asociacion) => (
        <View key={asociacion.paquete} style={styles.filaAsociacion}>
          <Text>{asociacion.paquete} → {suscripciones.find(({ id }) => id === asociacion.suscripcionId)?.nombre ?? 'Suscripción no disponible'}</Text>
          <NavButton
            testID={`quitar-asociacion-${asociacion.paquete}`}
            title="Quitar"
            variant="secondary"
            onPress={() => void quitarAsociacion(asociacion.paquete)}
          />
        </View>
      ))}

      {error ? <Text testID="error-asociacion-paquete" accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <NavButton
        testID="recargar-asociaciones-paquete"
        title="Actualizar"
        variant="secondary"
        disabled={cargando}
        onPress={() => { setCargando(true); void cargar(); }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, gap: 16, backgroundColor: '#f8fafc' },
  titulo: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitulo: { fontSize: 16, fontWeight: '700', color: '#334155' },
  texto: { color: '#475569', lineHeight: 22 },
  filaSuscripcion: { padding: 12, gap: 8, borderRadius: 8, backgroundColor: '#fff' },
  nombre: { fontWeight: '700', color: '#0f172a' },
  paqueteActual: { color: '#475569' },
  formulario: { gap: 10, padding: 12, borderRadius: 8, backgroundColor: '#e2e8f0' },
  entrada: { padding: 12, borderWidth: 1, borderColor: '#94a3b8', borderRadius: 6, backgroundColor: '#fff' },
  filaAsociacion: { gap: 8, padding: 12, borderBottomWidth: 1, borderColor: '#cbd5e1' },
  error: { color: '#991b1b' },
});
