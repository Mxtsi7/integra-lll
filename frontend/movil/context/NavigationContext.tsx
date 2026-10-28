import { useNavigation as useReactNavigation } from '@react-navigation/native';
import type { NavigationProp } from '@react-navigation/native';
import type { RootStackParamList } from '../src/navigation/types';

export * from '../src/navigation/types';

/**
 * Hook de navegación compatible con React Navigation.
 * Se recomienda usar directamente `useNavigation` de `@react-navigation/native`.
 */
export function useNavigation() {
  return useReactNavigation<NavigationProp<RootStackParamList>>();
}
