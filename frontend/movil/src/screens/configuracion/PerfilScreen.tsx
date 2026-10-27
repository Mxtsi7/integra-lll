import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { ScreenPlaceholder } from '../components/ScreenPlaceholder';
import { NavButton } from '../components/NavButton';
import { useAuth } from '../../../context/AuthContext';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function PerfilScreen({ navigation }: ConfiguracionScreenProps<'Perfil'>) {
  const { usuario } = useAuth();

  return (
    <ScreenPlaceholder
      testID="screen-perfil"
      titulo="Perfil de Usuario"
      tareaId="AN-03"
      responsable="Andrea Travola"
      descripcion="Consulta y edición de datos del usuario titular."
    >
      <Text style={styles.infoText}>Nombre: {usuario?.nombre ?? 'Cargando...'}</Text>
      <Text style={styles.infoText}>Correo: {usuario?.correo ?? 'Cargando...'}</Text>
      <Text style={styles.infoText}>Plan: {usuario?.plan ?? 'gratuito'}</Text>
      <NavButton
        testID="go-back"
        title="Volver a Configuración"
        onPress={() => navigation.goBack()}
      />
    </ScreenPlaceholder>
  );
}

const styles = StyleSheet.create({
  infoText: {
    fontSize: 14,
    color: '#334155',
    marginBottom: 6,
    textAlign: 'center',
  },
});
