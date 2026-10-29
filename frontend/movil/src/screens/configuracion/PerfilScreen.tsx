import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { actualizarNombre } from '@ojoalgasto/shared';
import { useAuth } from '../../../context/AuthContext';
import { Loading, NetworkError } from '../../components/estados';
import { PerfilContenido } from '../components/perfil/PerfilContenido';
import { COLORES_PERFIL as C } from '../components/perfil/estilos';
import { NavButton } from '../components/NavButton';
import type { ConfiguracionScreenProps } from '../../navigation/types';

export default function PerfilScreen({ navigation }: ConfiguracionScreenProps<'Perfil'>) {
  const { usuario, estadoPerfil, errorPerfil, recargarPerfil } = useAuth();

  // El dato que se muestra es el que confirma el servidor: se guarda y se vuelve a leer GET /usuarios/me/.
  async function guardarNombre(nombre: string) {
    await actualizarNombre(nombre);
    await recargarPerfil();
  }

  let cuerpo: React.ReactNode;
  if (usuario) {
    cuerpo = <PerfilContenido usuario={usuario} onGuardarNombre={guardarNombre} />;
  } else if (estadoPerfil === 'error') {
    cuerpo = (
      <NetworkError
        onReintentar={() => void recargarPerfil()}
        mensaje={errorPerfil ?? undefined}
      />
    );
  } else {
    cuerpo = <Loading mensaje="Cargando tu perfil…" />;
  }

  return (
    <ScrollView testID="screen-perfil" contentContainerStyle={styles.contenedor}>
      <Text style={styles.titulo}>Mi perfil</Text>
      {cuerpo}
      <NavButton
        testID="go-back"
        title="Volver a Configuración"
        variant="secondary"
        onPress={() => navigation.goBack()}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  contenedor: {
    flexGrow: 1,
    padding: 20,
    gap: 16,
    backgroundColor: C.fondo,
  },
  titulo: {
    fontSize: 26,
    fontWeight: 'bold',
    color: C.tinta,
  },
});
