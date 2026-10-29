import React from 'react';

if (typeof HTMLElement !== 'undefined') {
  (HTMLElement.prototype as any).measure = function (cb: any) {
    if (cb) cb(0, 0, 390, 844, 0, 0);
  };
  (HTMLElement.prototype as any).measureInWindow = function (cb: any) {
    if (cb) cb(0, 0, 390, 844);
  };
}

export const View = React.forwardRef<HTMLDivElement, any>(
  ({ testID, children, style, onLayout, ...props }, ref) => {
    React.useEffect(() => {
      if (onLayout) {
        onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } });
      }
    }, [onLayout]);

    return (
      <div data-testid={testID} style={typeof style === 'object' ? style : undefined} ref={ref} {...props}>
        {children}
      </div>
    );
  }
);
View.displayName = 'View';

export const Text = React.forwardRef<HTMLSpanElement, any>(
  ({ testID, children, style, ...props }, ref) => (
    <span data-testid={testID} style={typeof style === 'object' ? style : undefined} ref={ref} {...props}>
      {children}
    </span>
  )
);
Text.displayName = 'Text';

export const Pressable = React.forwardRef<HTMLButtonElement, any>(
  ({ testID, children, onPress, style, ...props }, ref) => (
    <button
      data-testid={testID}
      type="button"
      onClick={onPress}
      style={typeof style === 'object' ? style : undefined}
      ref={ref}
      {...props}
    >
      {children}
    </button>
  )
);
Pressable.displayName = 'Pressable';

export const ScrollView = React.forwardRef<HTMLDivElement, any>(
  ({ testID, children, style, ...props }, ref) => (
    <div data-testid={testID} style={typeof style === 'object' ? style : undefined} ref={ref} {...props}>
      {children}
    </div>
  )
);
ScrollView.displayName = 'ScrollView';

export const ActivityIndicator = ({ testID }: { testID?: string }) => (
  <div data-testid={testID}>Cargando…</div>
);

export const StyleSheet = {
  create: <T extends Record<string, any>>(styles: T): T => styles,
  flatten: (style: any) => style,
};

export const Platform = {
  OS: 'ios',
  select: (obj: any) => obj.ios ?? obj.default,
};

export const Animated = {
  View,
  Text,
  createAnimatedComponent: (comp: any) => comp,
  Value: class {
    constructor(public val: number) {}
    setValue(v: number) {
      this.val = v;
    }
    interpolate() {
      return this;
    }
    stopAnimation(cb?: any) {
      if (cb) cb(this.val);
    }
    addListener() {
      return 'listener-id';
    }
    removeListener() {}
  },
  timing: () => ({ start: (cb?: any) => cb && cb({ finished: true }) }),
  spring: () => ({ start: (cb?: any) => cb && cb({ finished: true }) }),
  parallel: () => ({ start: (cb?: any) => cb && cb({ finished: true }) }),
  sequence: () => ({ start: (cb?: any) => cb && cb({ finished: true }) }),
};

export const BackHandler = {
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
};

export const I18nManager = {
  isRTL: false,
  doLeftAndRightSwapInRTL: false,
  getConstants: () => ({ isRTL: false, doLeftAndRightSwapInRTL: false }),
};

export const Dimensions = {
  get: (_dim?: string) => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
  removeEventListener: () => {},
};

export const PixelRatio = {
  get: () => 2,
  getFontScale: () => 1,
  getPixelSizeForLayoutSize: (size: number) => size * 2,
  roundToNearestPixel: (size: number) => size,
};

const identity = (t: any) => t;
export const Easing = {
  linear: identity,
  ease: identity,
  quad: identity,
  cubic: identity,
  poly: () => identity,
  sin: identity,
  circle: identity,
  exp: identity,
  elastic: () => identity,
  back: () => identity,
  bounce: identity,
  bezier: () => identity,
  in: () => identity,
  out: () => identity,
  inOut: () => identity,
};

export const Image = React.forwardRef<HTMLImageElement, any>(
  ({ testID, source, style, ...props }, ref) => (
    <img
      data-testid={testID}
      src={typeof source === 'object' ? source?.uri : source}
      style={typeof style === 'object' ? style : undefined}
      ref={ref}
      {...props}
    />
  )
);
Image.displayName = 'Image';

export const Keyboard = {
  addListener: () => ({ remove: () => {} }),
  removeListener: () => {},
  dismiss: () => {},
};

export const TextInput = React.forwardRef<HTMLInputElement, any>(
  ({ testID, value, onChangeText, onChange, secureTextEntry, style, placeholder, ...props }, ref) => (
    <input
      data-testid={testID}
      type={secureTextEntry ? 'password' : 'text'}
      value={value}
      placeholder={placeholder}
      onChange={(e) => {
        if (onChangeText) onChangeText(e.target.value);
        if (onChange) onChange(e);
      }}
      style={typeof style === 'object' ? style : undefined}
      ref={ref}
      {...props}
    />
  )
);
TextInput.displayName = 'TextInput';

export default {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Animated,
  BackHandler,
  I18nManager,
  Dimensions,
  PixelRatio,
  Easing,
  Image,
  Keyboard,
  TextInput,
};
