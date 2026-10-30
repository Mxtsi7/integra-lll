import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { type Usuario } from '@ojoalgasto/shared';
import { AuthProvider, type EstadoAuth } from './context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { configurarClienteHttp, inicializarStorageSeguro } from './src/services';

configurarClienteHttp();
inicializarStorageSeguro();

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
