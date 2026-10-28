import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { ConfiguracionStackParamList } from './types';
import ConfiguracionScreen from '../screens/configuracion/ConfiguracionScreen';
import PerfilScreen from '../screens/configuracion/PerfilScreen';
import CuentasConectadasScreen from '../screens/configuracion/CuentasConectadasScreen';
import PlanesScreen from '../screens/configuracion/PlanesScreen';
import AlertasScreen from '../screens/configuracion/AlertasScreen';
import AutorizacionCorreoScreen from '../screens/configuracion/AutorizacionCorreoScreen';
import RestriccionesPremiumScreen from '../screens/configuracion/RestriccionesPremiumScreen';
import EliminarCuentaScreen from '../screens/configuracion/EliminarCuentaScreen';

const Stack = createNativeStackNavigator<ConfiguracionStackParamList>();

export function ConfiguracionNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="ConfiguracionScreen"
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="ConfiguracionScreen"
        component={ConfiguracionScreen}
        options={{ title: 'Configuración' }}
      />
      <Stack.Screen
        name="Perfil"
        component={PerfilScreen}
        options={{ title: 'Mi Perfil' }}
      />
      <Stack.Screen
        name="CuentasConectadas"
        component={CuentasConectadasScreen}
        options={{ title: 'Cuentas Conectadas' }}
      />
      <Stack.Screen
        name="Planes"
        component={PlanesScreen}
        options={{ title: 'Planes y Suscripción' }}
      />
      <Stack.Screen
        name="Alertas"
        component={AlertasScreen}
        options={{ title: 'Centro de Alertas' }}
      />
      <Stack.Screen
        name="AutorizacionCorreo"
        component={AutorizacionCorreoScreen}
        options={{ title: 'Autorización de Correo' }}
      />
      <Stack.Screen
        name="RestriccionesPremium"
        component={RestriccionesPremiumScreen}
        options={{ title: 'Restricciones Premium' }}
      />
      <Stack.Screen
        name="EliminarCuenta"
        component={EliminarCuentaScreen}
        options={{ title: 'Eliminar Cuenta' }}
      />
    </Stack.Navigator>
  );
}
