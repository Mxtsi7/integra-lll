import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { configurarApi, configureAuthApi, type Usuario } from '@ojoalgasto/shared';
import { AuthProvider, type EstadoAuth } from './context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';

const urlBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api';
configurarApi({ urlBase });
configureAuthApi({ baseUrl: urlBase });

export type AppProps = {
  initialUsuario?: Usuario | null;
  initialEstado?: EstadoAuth;
  exp?: Record<string, unknown>;
  shell?: boolean;
  shellManifestUrl?: string;
};

export function App({ initialUsuario, initialEstado }: AppProps = {}) {
  return (
    <SafeAreaProvider>
      <AuthProvider initialUsuario={initialUsuario} initialEstado={initialEstado}>
        <NavigationContainer>
          <RootNavigator />
          <StatusBar style="auto" />
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

export default App;
