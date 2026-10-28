import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { CalendarioStackParamList } from './types';
import CalendarioScreen from '../screens/calendario/CalendarioScreen';

const Stack = createNativeStackNavigator<CalendarioStackParamList>();

export function CalendarioNavigator() {
  return (
    <Stack.Navigator
      initialRouteName="CalendarioScreen"
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="CalendarioScreen"
        component={CalendarioScreen}
        options={{ title: 'Calendario y Agenda' }}
      />
    </Stack.Navigator>
  );
}
