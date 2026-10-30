import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
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
