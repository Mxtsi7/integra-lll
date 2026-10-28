import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { HomeStackParamList } from './types';
import HomeScreen from '../screens/home/HomeScreen';
import SuscripcionDetalleScreen from '../screens/home/SuscripcionDetalleScreen';
import SuscripcionNuevaScreen from '../screens/home/SuscripcionNuevaScreen';

const Stack = createNativeStackNavigator<HomeStackParamList>();

export function HomeNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="HomeScreen"
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="HomeScreen"
        component={HomeScreen}
        options={{ title: 'Suscripciones' }}
      />
      <Stack.Screen
        name="SuscripcionDetalle"
        component={SuscripcionDetalleScreen}
        options={{ title: 'Detalle de Suscripción' }}
      />
      <Stack.Screen
        name="SuscripcionNueva"
        component={SuscripcionNuevaScreen}
        options={{ title: 'Nueva Suscripción' }}
      />
    </Stack.Navigator>
  );
}
