import { StyleSheet } from 'react-native';

/**
 * Módulo de estilos para el componente NavButton.
 * Implementado con StyleSheet de React Native (equivalente modular a CSS modules).
 */
export const styles = StyleSheet.create({
  button: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primary: {
    backgroundColor: '#0f172a',
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  danger: {
    backgroundColor: '#ef4444',
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.45,
  },
  text: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  secondaryText: {
    color: '#1e293b',
  },
});

export default styles;
