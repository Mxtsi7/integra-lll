import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';

/** Layout básico de prueba para compatibilidad */
export function NavTestLayout({ title = 'Test Screen' }: { title?: string; [key: string]: any }) {
  const navigation = useNavigation<any>();

  return (
    <View style={styles.container} testID="screen-test">
      <Text style={styles.title}>{title}</Text>
      {navigation.canGoBack?.() ? (
        <Pressable
          testID="go-back"
          style={styles.button}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.buttonText}>Volver</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { fontSize: 28, fontWeight: '700', color: '#14213d' },
  button: { backgroundColor: '#14213d', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 10 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
