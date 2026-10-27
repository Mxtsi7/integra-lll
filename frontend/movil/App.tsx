import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { configurarApi, type Usuario } from '@ojoalgasto/shared';
import { AuthProvider, type EstadoAuth } from './context/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';

configurarApi({ urlBase: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api' });

export type AppProps = {
  initialUsuario?: Usuario | null;
  initialEstado?: EstadoAuth;
  [key: string]: unknown;
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
