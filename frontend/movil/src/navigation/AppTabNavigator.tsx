import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { AppTabParamList } from './types';
import { HomeNavigator } from './HomeNavigator';
import { PanelNavigator } from './PanelNavigator';
import { CalendarioNavigator } from './CalendarioNavigator';
import { ConfiguracionNavigator } from './ConfiguracionNavigator';

const Tab = createBottomTabNavigator<AppTabParamList>();

export function AppTabNavigator() {
  return (
    <Tab.Navigator
      initialRouteName="HomeTab"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#0f172a',
        tabBarInactiveTintColor: '#94a3b8',
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopColor: '#e2e8f0',
          height: 60,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen
        name="HomeTab"
        component={HomeNavigator}
        options={{
          tabBarLabel: 'Home',
          tabBarButtonTestID: 'tab-home',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>🏠</Text>,
        }}
      />
      <Tab.Screen
        name="PanelTab"
        component={PanelNavigator}
        options={{
          tabBarLabel: 'Panel',
          tabBarButtonTestID: 'tab-panel',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📊</Text>,
        }}
      />
      <Tab.Screen
        name="CalendarioTab"
        component={CalendarioNavigator}
        options={{
          tabBarLabel: 'Calendario',
          tabBarButtonTestID: 'tab-calendario',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>📅</Text>,
        }}
      />
      <Tab.Screen
        name="ConfiguracionTab"
        component={ConfiguracionNavigator}
        options={{
          tabBarLabel: 'Configuración',
          tabBarButtonTestID: 'tab-configuracion',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18, color }}>⚙️</Text>,
        }}
      />
    </Tab.Navigator>
  );
}
