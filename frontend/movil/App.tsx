import { StatusBar } from 'expo-status-bar';
import { BackHandler } from 'react-native';
import { useEffect } from 'react';
import { configurarApi } from '@ojoalgasto/shared';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { HomeScreen, LoginScreen, ProfileScreen, SettingsScreen } from './screens';

configurarApi({ urlBase: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8000/api' });

function Router() {
  const { screen, goBack, canGoBack } = useNavigation();

  // Botón físico "atrás" en Android.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        goBack();
        return true; // evento manejado
      }
      return false; // deja que Android cierre la app
    });
    return () => sub.remove();
  }, [canGoBack, goBack]);

  switch (screen) {
    case 'login':
      return <LoginScreen />;
    case 'home':
      return <HomeScreen />;
    case 'profile':
      return <ProfileScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

export default function App() {
  return (
    <NavigationProvider initial="login">
      <Router />
      <StatusBar style="auto" />
    </NavigationProvider>
  );
}
