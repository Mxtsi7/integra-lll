import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { PanelStackParamList } from './types';
import PanelScreen from '../screens/panel/PanelScreen';
import InformesScreen from '../screens/panel/InformesScreen';
import RecomendacionesScreen from '../screens/panel/RecomendacionesScreen';

const Stack = createNativeStackNavigator<PanelStackParamList>();

export function PanelNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="PanelScreen"
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="PanelScreen"
        component={PanelScreen}
        options={{ title: 'Resumen de Gasto' }}
      />
      <Stack.Screen
        name="Informes"
        component={InformesScreen}
        options={{ title: 'Informes por Periodo' }}
      />
      <Stack.Screen
        name="Recomendaciones"
        component={RecomendacionesScreen}
        options={{ title: 'Recomendaciones' }}
      />
    </Stack.Navigator>
  );
}
