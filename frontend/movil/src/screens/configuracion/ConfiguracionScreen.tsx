import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { NavButton } from '../components/NavButton';
import { useAuth } from '../../../context/AuthContext';
import type { ConfiguracionScreenProps } from '../../navigation/types';
import { SECCIONES_CONFIGURACION, type DestinoConfiguracion } from './secciones';

export default function ConfiguracionScreen({
  navigation,
}: ConfiguracionScreenProps<'ConfiguracionScreen'>) {
  const { cerrarSesion, errorCierre, reintentarCierre } = useAuth();

  const ir: Record<DestinoConfiguracion, () => void> = {
    Perfil: () => navigation.navigate('Perfil'),
    CuentasConectadas: () => navigation.navigate('CuentasConectadas'),
    Planes: () => navigation.navigate('Planes'),
    Alertas: () => navigation.navigate('Alertas'),
    AutorizacionCorreo: () => navigation.navigate('AutorizacionCorreo'),
    RestriccionesPremium: () => navigation.navigate('RestriccionesPremium'),
    EliminarCuenta: () => navigation.navigate('EliminarCuenta'),
  };

  return (
    <ScrollView testID="screen-configuracion" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Configuración</Text>

      {SECCIONES_CONFIGURACION.map((seccion) => (
        <View key={seccion.id} style={styles.seccion}>
          <Text style={styles.tituloSeccion}>{seccion.titulo}</Text>
          {seccion.items.map((item) => {
            const destino = item.destino;
            return (
              <NavButton
                key={item.testID}
                testID={item.testID}
                title={destino ? item.titulo : `${item.titulo} (próximamente)`}
                variant={item.variante ?? 'secondary'}
                disabled={!destino}
                onPress={() => {
                  if (destino) ir[destino]();
                }}
              />
            );
          })}
        </View>
      ))}

      <View style={styles.seccion}>
        <Text style={styles.tituloSeccion}>Sesión</Text>
        {errorCierre ? (
          <View style={styles.errorCierre}>
            <Text testID="cierre-pendiente" style={styles.textoError}>
              {errorCierre}
            </Text>
            <NavButton
              testID="reintentar-cierre"
              title="Reintentar limpieza"
              variant="secondary"
              onPress={() => void reintentarCierre()}
            />
          </View>
        ) : null}
        <NavButton
          testID="logout"
          title="Cerrar Sesión"
          variant="danger"
          onPress={() => void cerrarSesion()}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    padding: 20,
    backgroundColor: '#f8fafc',
    gap: 20,
  },
  titulo: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  seccion: {
    gap: 10,
  },
  tituloSeccion: {
    fontSize: 13,
    fontWeight: '700',
    color: '#64748b',
    textTransform: 'uppercase',
  },
  errorCierre: {
    gap: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  textoError: {
    color: '#991b1b',
    fontSize: 14,
  },
});
