import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
<<<<<<< Updated upstream
import { configurarApi } from '@ojoalgasto/shared'
   configurarApi({ urlBase: process.env.EXPO_PUBLIC_API_URL });
export default function App() {
  return (

    <View style={styles.container}>
      <Text>Open up App.tsx to start working on your app!
      Ojo al Gasto test 14/10/2026 </Text>

      <StatusBar style="auto" />
    </View>

=======
import { configurarApi } from '@ojoalgasto/shared';
configurarApi({ urlBase: process.env.EXPO_PUBLIC_API_URL });

export default function App() {
  return (
    <View style={styles.container}>
      <Text>alfin corre

        !</Text>
      <StatusBar style="auto" />
    </View>
>>>>>>> Stashed changes
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
