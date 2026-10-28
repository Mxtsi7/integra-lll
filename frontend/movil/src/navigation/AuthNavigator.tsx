import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { AuthStackParamList } from './types';
import LoginScreen from '../screens/auth/LoginScreen';
import RegistroScreen from '../screens/auth/RegistroScreen';
import RecuperarContrasenaScreen from '../screens/auth/RecuperarContrasenaScreen';
import VerificarCorreoScreen from '../screens/auth/VerificarCorreoScreen';

const Stack = createNativeStackNavigator<AuthStackParamList>();

export function AuthNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="Login"
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="Login"
        component={LoginScreen}
        options={{ title: 'Iniciar Sesión', headerShown: false }}
      />
      <Stack.Screen
        name="Registro"
        component={RegistroScreen}
        options={{ title: 'Crear Cuenta' }}
      />
      <Stack.Screen
        name="RecuperarContrasena"
        component={RecuperarContrasenaScreen}
        options={{ title: 'Recuperar Contraseña' }}
      />
      <Stack.Screen
        name="VerificarCorreo"
        component={VerificarCorreoScreen}
        options={{ title: 'Verificar Correo' }}
      />
    </Stack.Navigator>
  );
}
