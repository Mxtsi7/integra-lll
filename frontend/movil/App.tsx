import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  NavigationContainer,
  type LinkingOptions,
} from '@react-navigation/native';
import { configurarApi, configureAuthApi, type Usuario } from '@ojoalgasto/shared';
import { AuthProvider, type EstadoAuth } from './context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/types';
import { resolverUrlApi } from './src/config/api';
import { instalarAlmacenSeguro } from './src/storage/sesionSegura';

// VI-14: la URL se exige explícitamente. Si falta o usa localhost en un
// teléfono, la app muestra el motivo en pantalla en vez de fallar con un
// "sin conexión" indistinguible de un backend caído.
let errorConfiguracion: string | null = null;
try {
  const urlBase = resolverUrlApi();
  configurarApi({ urlBase });
  configureAuthApi({ baseUrl: urlBase });
  // VI-16: los tokens se persisten cifrados; ver src/storage/sesionSegura.ts.
  instalarAlmacenSeguro();
} catch (error) {
  errorConfiguracion =
    error instanceof Error ? error.message : 'Configuración de API inválida';
}

// VI-14: enlaces profundos del esquema declarado en app.json. El correo de
// verificación (MX-28) puede abrir la app directamente en la pantalla que
// recibe el token.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['ojoalgasto://'],
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          Registro: 'registro',
          RecuperarContrasena: 'recuperar-contrasena',
          VerificarCorreo: 'verificar-correo',
        },
      },
    },
  },
};

export type AppProps = {
  initialUsuario?: Usuario | null;
  initialEstado?: EstadoAuth;
  exp?: Record<string, unknown>;
  shell?: boolean;
  shellManifestUrl?: string;
};

export function App({ initialUsuario, initialEstado }: AppProps = {}) {
  if (errorConfiguracion) {
    return (
      <SafeAreaProvider>
        <View style={styles.errorContainer} testID="config-error">
          <Text style={styles.errorTitulo}>Falta configurar la app</Text>
          <Text style={styles.errorTexto}>{errorConfiguracion}</Text>
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <AuthProvider initialUsuario={initialUsuario} initialEstado={initialEstado}>
        <NavigationContainer linking={linking}>
          <RootNavigator />
          <StatusBar style="auto" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    gap: 12,
    backgroundColor: '#ffffff',
  },
  errorTitulo: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0f172a',
  },
  errorTexto: {
    fontSize: 15,
    lineHeight: 22,
    color: '#475569',
  },
});

export default App;
