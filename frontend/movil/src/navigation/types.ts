import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';

// ── 1. Flujo Público (Stack Acceso) ──────────────────────────────────
export type AuthStackParamList = {
  Login: undefined;
  Registro: undefined;
  RecuperarContrasena: undefined;
  VerificarCorreo: { token?: string } | undefined;
};

export type AuthScreenProps<T extends keyof AuthStackParamList> = NativeStackScreenProps<
  AuthStackParamList,
  T
>;

// ── 2. Stacks Privados por Pestaña ───────────────────────────────────

// Tab 1: Home / Suscripciones
export type HomeStackParamList = {
  HomeScreen: undefined;
  SuscripcionDetalle: { id: string };
  SuscripcionNueva: undefined;
};

// Tab 2: Panel / Métricas
export type PanelStackParamList = {
  PanelScreen: undefined;
  Informes: undefined;
  Recomendaciones: undefined;
};

// Tab 3: Calendario
export type CalendarioStackParamList = {
  CalendarioScreen: undefined;
};

// Tab 4: Configuración
export type ConfiguracionStackParamList = {
  ConfiguracionScreen: undefined;
  Perfil: undefined;
  CuentasConectadas: undefined;
  Planes: undefined;
  Alertas: undefined;
  AutorizacionCorreo: undefined;
  RestriccionesPremium: undefined;
  EliminarCuenta: undefined;
};

// ── 3. Bottom Tabs (4 pestañas principales) ──────────────────────────
export type AppTabParamList = {
  HomeTab: NavigatorScreenParams<HomeStackParamList>;
  PanelTab: NavigatorScreenParams<PanelStackParamList>;
  CalendarioTab: NavigatorScreenParams<CalendarioStackParamList>;
  ConfiguracionTab: NavigatorScreenParams<ConfiguracionStackParamList>;
};

// ── 4. Root Stack (Separación Pública / Privada) ──────────────────────
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<AppTabParamList>;
};

// Helpers de tipado para pantallas individuales en tabs
export type HomeScreenProps<T extends keyof HomeStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<HomeStackParamList, T>,
  BottomTabScreenProps<AppTabParamList>
>;

export type PanelScreenProps<T extends keyof PanelStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<PanelStackParamList, T>,
  BottomTabScreenProps<AppTabParamList>
>;

export type CalendarioScreenProps<T extends keyof CalendarioStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<CalendarioStackParamList, T>,
  BottomTabScreenProps<AppTabParamList>
>;

export type ConfiguracionScreenProps<T extends keyof ConfiguracionStackParamList> = CompositeScreenProps<
  NativeStackScreenProps<ConfiguracionStackParamList, T>,
  BottomTabScreenProps<AppTabParamList>
>;

// Declaración global para que useNavigation() tenga tipado automático
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
