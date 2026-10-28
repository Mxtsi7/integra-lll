import React from 'react';

export const SafeAreaInsetsContext = React.createContext({ top: 0, left: 0, right: 0, bottom: 0 });

export const SafeAreaProvider = ({ children }: { children?: React.ReactNode }) => (
  <SafeAreaInsetsContext.Provider value={{ top: 0, left: 0, right: 0, bottom: 0 }}>
    {children}
  </SafeAreaInsetsContext.Provider>
);

export const SafeAreaView = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

export const useSafeAreaInsets = () => React.useContext(SafeAreaInsetsContext);

export const initialWindowMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export default {
  SafeAreaInsetsContext,
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
  initialWindowMetrics,
};
