import React from 'react';

export const enableScreens = () => {};
export const screensEnabled = () => true;
export const Screen = ({ children, ...props }: any) => <div {...props}>{children}</div>;
export const ScreenContainer = ({ children, ...props }: any) => <div {...props}>{children}</div>;
export const NativeScreen = Screen;
export const NativeScreenContainer = ScreenContainer;
export const ScreenStack = ({ children, ...props }: any) => <div {...props}>{children}</div>;
export const ScreenStackHeaderConfig = () => null;

export default {
  enableScreens,
  screensEnabled,
  Screen,
  ScreenContainer,
  NativeScreen,
  NativeScreenContainer,
  ScreenStack,
  ScreenStackHeaderConfig,
};
