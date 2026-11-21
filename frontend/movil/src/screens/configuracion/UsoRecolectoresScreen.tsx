import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { NavButton } from '../components/NavButton';
import { usoAndroidNativo } from '../../services/usoAndroidNativo';
import { crearControlPermisoUsoAndroid, type EstadoPermisoUsoAndroid } from '../../services/usoAndroid';

const CONTROL_PERMISO = crearControlPermisoUsoAndroid(usoAndroidNativo);

const ETIQUETAS_PERMISO: Record<EstadoPermisoUsoAndroid, string> = {
  cargando: 'Comprobando permiso…',
  no_disponible: 'Disponible solo en una compilación Android compatible.',
  requerido: 'El permiso de acceso al uso está desactivado.',
  concedido: 'El permiso de Android está concedido.',
  error: 'No se pudo comprobar el permiso. Inténtalo de nuevo.',
};

export default function UsoRecolectoresScreen() {
  const [estadoPermiso, setEstadoPermiso] = useState<EstadoPermisoUsoAndroid>('cargando');

  const verificarPermiso = useCallback(async () => {
    setEstadoPermiso('cargando');
    setEstadoPermiso(await CONTROL_PERMISO.verificar());
  }, []);

  useEffect(() => {
    void CONTROL_PERMISO.verificar().then(setEstadoPermiso);
    const suscripcion = AppState.addEventListener('change', (estadoAplicacion) => {
      if (estadoAplicacion === 'active') void verificarPermiso();
    });
    return () => suscripcion.remove();
  }, [verificarPermiso]);

  const abrirAjustes = async () => {
    const seAbrieron = await CONTROL_PERMISO.abrirAjustes();
    if (!seAbrieron) setEstadoPermiso(usoAndroidNativo ? 'error' : 'no_disponible');
  };

  return (
    <ScrollView testID="screen-uso-recolectores" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Acceso de uso</Text>
      <View style={styles.estado}>
        <Text style={styles.etiqueta}>Permiso del sistema</Text>
        <Text testID="estado-permiso-uso">{ETIQUETAS_PERMISO[estadoPermiso]}</Text>
      </View>
      <Text style={styles.texto}>
        Android gestiona este permiso en Ajustes. Al volver a la app se comprobará de nuevo;
        abrir Ajustes no se considera una concesión.
      </Text>
      <Text style={styles.texto}>
        No se consultan estadísticas hasta que exista permiso del sistema y consentimiento
        vigente de captura. La validación de consentimiento de uso aún no está disponible.
      </Text>
      <NavButton
        testID="abrir-ajustes-uso"
        title="Abrir ajustes de acceso al uso"
        onPress={() => void abrirAjustes()}
        disabled={!usoAndroidNativo || estadoPermiso === 'cargando'}
      />
      <NavButton
        testID="verificar-permiso-uso"
        title="Volver a comprobar permiso"
        variant="secondary"
        onPress={() => void verificarPermiso()}
        disabled={!usoAndroidNativo || estadoPermiso === 'cargando'}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: { padding: 20, gap: 16, backgroundColor: '#f8fafc' },
  titulo: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  estado: { padding: 14, borderRadius: 8, gap: 6, backgroundColor: '#e2e8f0' },
  etiqueta: { fontWeight: '700', color: '#334155' },
  texto: { color: '#475569', lineHeight: 22 },
});
