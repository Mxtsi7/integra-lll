import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SCREENS, Screen, useNavigation } from '../context/NavigationContext';

const INFO: Record<Screen, { title: string; color: string }> = {
  login: { title: 'Login', color: '#fde8d7' },
  home: { title: 'Home', color: '#d9ecd0' },
  profile: { title: 'Profile', color: '#d6e4f5' },
  settings: { title: 'Settings', color: '#ebdcf3' },
};

/** Layout de las pantallas de prueba: título, historial y acceso libre a todas las demás. */
export function NavTestLayout({ screen }: { screen: Screen }) {
  const { navigate, goBack, history, canGoBack } = useNavigation();
  const { title, color } = INFO[screen];

  return (
    <View style={[styles.container, { backgroundColor: color }]} testID={`screen-${screen}`}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.history} testID="history">
        {`Historial: ${history.join(' › ')}`}
      </Text>

      <View style={styles.actions}>
        {SCREENS.filter((s) => s !== screen).map((s) => (
          <Pressable
            key={s}
            testID={`go-${s}`}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            onPress={() => navigate(s)}
          >
            <Text style={styles.buttonText}>Ir a {INFO[s].title}</Text>
          </Pressable>
        ))}

        {canGoBack && (
          <Pressable testID="go-back" style={[styles.button, styles.secondary]} onPress={goBack}>
            <Text style={styles.secondaryText}>Volver</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: '700', color: '#14213d' },
  history: { fontSize: 13, color: '#3d4a66', marginBottom: 16 },
  actions: { width: '100%', maxWidth: 320, gap: 10 },
  button: { backgroundColor: '#14213d', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  pressed: { opacity: 0.8 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: '#14213d' },
  secondaryText: { color: '#14213d', fontSize: 16, fontWeight: '600' },
});
