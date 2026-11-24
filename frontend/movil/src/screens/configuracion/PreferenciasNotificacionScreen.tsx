import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { NavButton } from '../components/NavButton';
import { PreferenciasNotificacionesContenido } from '../components/notificaciones/PreferenciasNotificacionesContenido';
import { styles } from '../components/notificaciones/notificaciones.styles';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function PreferenciasNotificacionScreen({
  navigation,
}: ConfiguracionScreenProps<'PreferenciasNotificacion'>) {
  return (
    <View style={styles.safeArea} testID="screen-preferencias-notificacion">
      <View style={styles.contenedor}>
        <ScrollView
          contentContainerStyle={styles.scrollContenido}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <Text style={styles.titulo} accessibilityRole="header">
              Preferencias de notificación
            </Text>
            <Text style={styles.subtitulo}>
              Elige por dónde y de qué eventos te avisamos.
            </Text>
          </View>

          <PreferenciasNotificacionesContenido />

          <NavButton
            testID="go-back"
            title="Volver a Configuración"
            variant="secondary"
            onPress={() => navigation.goBack()}
            style={{ marginTop: 24 }}
          />
        </ScrollView>
      </View>
    </View>
  );
}
