import React from 'react';
import { View, ActivityIndicator, StyleSheet, Text } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import { AuthNavigator } from './AuthNavigator';
import { AppTabNavigator } from './AppTabNavigator';
import { useAuth } from '../../context/AuthContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { estado, haySesion } = useAuth();

  if (estado === 'cargando') {
    return (
      <View style={styles.loadingContainer} testID="splash-loading">
        <ActivityIndicator size="large" color="#0f172a" />
        <Text style={styles.loadingText}>Iniciando aplicación…</Text>
      </View>
    );
  }

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {!haySesion ? (
        <Stack.Screen name="Auth" component={AuthNavigator} />
      ) : (
        <Stack.Screen name="App" component={AppTabNavigator} />
      )}
    </Stack.Navigator>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    color: '#64748b',
    fontWeight: '500',
  },
});
