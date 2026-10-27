import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export const SCREENS = ['login', 'home', 'profile', 'settings'] as const;
export type Screen = (typeof SCREENS)[number];

type NavigationValue = {
  screen: Screen;
  history: Screen[];
  navigate: (to: Screen) => void;
  goBack: () => void;
  canGoBack: boolean;
};

const NavigationContext = createContext<NavigationValue | null>(null);

export function NavigationProvider({
  initial = 'login',
  children,
}: {
  initial?: Screen;
  children: React.ReactNode;
}) {
  // El último elemento es la pantalla actual.
  const [stack, setStack] = useState<Screen[]>([initial]);

  const navigate = useCallback((to: Screen) => {
    setStack((prev) => (prev[prev.length - 1] === to ? prev : [...prev, to]));
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const value = useMemo<NavigationValue>(
    () => ({
      screen: stack[stack.length - 1],
      history: stack,
      navigate,
      goBack,
      canGoBack: stack.length > 1,
    }),
    [stack, navigate, goBack]
  );

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation debe usarse dentro de <NavigationProvider>');
  return ctx;
}
