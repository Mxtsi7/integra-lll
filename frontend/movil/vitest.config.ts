import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    // En pruebas la URL es obligatoria igual que en la app. Se usa una IP LAN
    // ficticia (no localhost) porque Platform.OS se simula como "ios".
    env: {
      EXPO_PUBLIC_API_URL: 'http://192.168.1.10:8000/api',
    },
    server: {
      deps: {
        inline: [/@react-navigation/],
      },
    },
  },
  ssr: {
    noExternal: [/@react-navigation/],
  },
  resolve: {
    extensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    alias: {
      react: path.resolve(__dirname, '../node_modules/react'),
      'react-dom': path.resolve(__dirname, '../node_modules/react-dom'),
      'react-native': path.resolve(__dirname, './test/react-native-shim.tsx'),
      'react-native-safe-area-context': path.resolve(__dirname, './test/safe-area-shim.tsx'),
      'react-native-screens': path.resolve(__dirname, './test/react-native-screens-shim.tsx'),
      'expo-status-bar': path.resolve(__dirname, './test/expo-status-bar-shim.tsx'),
      'expo-secure-store': path.resolve(__dirname, './test/expo-secure-store-shim.ts'),
    },
  },
});
