# Contrato de Navegación Móvil (SE-06)

Este documento define la arquitectura, contrato de tipos y reglas de integración de la navegación móvil para el equipo (**Sebastian Mena** y **Andrea Travola**).

> [!NOTE]
> **Diseño temporal:** Las pantallas actuales son stubs/placeholders con estilos temporales generados por IA exclusivamente para probar rutas y contratos. Cada integrante sustituirá la interfaz con el diseño definitivo en su respectiva tarea.

---

## 1. Regla de Oro de Contenedores

> [!IMPORTANT]
> **Nunca instanciar un `<NavigationContainer>` adicional.**
> Existe un único `<NavigationContainer>` configurado en [frontend/movil/App.tsx](App.tsx).
> Para agregar pantallas o componentes, reutiliza los navegadores existentes y consume `useNavigation()`.

---

## 2. Árbol de Navegadores

```
NavigationContainer (App.tsx)
 │
 ├── Flujo Público: AuthNavigator (Native Stack)
 │    ├── Login (SE-09)
 │    ├── Registro (SE-11)
 │    ├── RecuperarContrasena (SE-14)
 │    └── VerificarCorreo (AN-12)
 │
 └── Flujo Privado: AppTabNavigator (Bottom Tabs)
      ├── Tab 'HomeTab' → HomeNavigator (Native Stack)
      │    ├── HomeScreen (SE-17)
      │    ├── SuscripcionDetalle (SE-21) [params: { id: string }]
      │    └── SuscripcionNueva (SE-22)
      │
      ├── Tab 'PanelTab' → PanelNavigator (Native Stack)
      │    ├── PanelScreen (AN-01)
      │    ├── Informes (AN-23)
      │    └── Recomendaciones (AN-05)
      │
      ├── Tab 'CalendarioTab' → CalendarioNavigator (Native Stack)
      │    └── CalendarioScreen (AN-07)
      │
      └── Tab 'ConfiguracionTab' → ConfiguracionNavigator (Native Stack)
           ├── ConfiguracionScreen (AN-04)
           ├── Perfil (AN-03)
           ├── CuentasConectadas (AN-06)
           ├── Planes (AN-08)
           ├── Alertas (AN-10)
           ├── AutorizacionCorreo (AN-09)
           ├── RestriccionesPremium (AN-11)
           └── EliminarCuenta (AN-19)
```

---

## 3. Matriz de Tareas y Pantallas Desbloqueadas

| Tarea | Responsable | Nombre Pantalla | Archivo Fuente | Parámetros |
|---|---|---|---|---|
| **SE-09** | Sebastian Mena | `Login` | `src/screens/auth/LoginScreen.tsx` | Ninguno |
| **SE-11** | Sebastian Mena | `Registro` | `src/screens/auth/RegistroScreen.tsx` | Ninguno |
| **SE-14** | Sebastian Mena | `RecuperarContrasena` | `src/screens/auth/RecuperarContrasenaScreen.tsx` | Ninguno |
| **AN-12** | Andrea Travola | `VerificarCorreo` | `src/screens/auth/VerificarCorreoScreen.tsx` | `{ token?: string }` |
| **SE-17** | Sebastian Mena | `HomeScreen` | `src/screens/home/HomeScreen.tsx` | Ninguno |
| **SE-21** | Sebastian Mena | `SuscripcionDetalle` | `src/screens/home/SuscripcionDetalleScreen.tsx` | `{ id: string }` *(requerido)* |
| **SE-22** | Sebastian Mena | `SuscripcionNueva` | `src/screens/home/SuscripcionNuevaScreen.tsx` | Ninguno |
| **AN-01** | Andrea Travola | `PanelScreen` | `src/screens/panel/PanelScreen.tsx` | Ninguno |
| **AN-23** | Andrea Travola | `Informes` | `src/screens/panel/InformesScreen.tsx` | Ninguno |
| **AN-05** | Andrea Travola | `Recomendaciones` | `src/screens/panel/RecomendacionesScreen.tsx` | Ninguno |
| **AN-07** | Andrea Travola | `CalendarioScreen` | `src/screens/calendario/CalendarioScreen.tsx` | Ninguno |
| **AN-04** | Andrea Travola | `ConfiguracionScreen` | `src/screens/configuracion/ConfiguracionScreen.tsx` | Ninguno |
| **AN-03** | Andrea Travola | `Perfil` | `src/screens/configuracion/PerfilScreen.tsx` | Ninguno |
| **AN-06** | Andrea Travola | `CuentasConectadas` | `src/screens/configuracion/CuentasConectadasScreen.tsx` | Ninguno |
| **AN-08** | Andrea Travola | `Planes` | `src/screens/configuracion/PlanesScreen.tsx` | Ninguno |
| **AN-10** | Andrea Travola | `Alertas` | `src/screens/configuracion/AlertasScreen.tsx` | Ninguno |
| **AN-09** | Andrea Travola | `AutorizacionCorreo` | `src/screens/configuracion/AutorizacionCorreoScreen.tsx` | Ninguno |
| **AN-11** | Andrea Travola | `RestriccionesPremium` | `src/screens/configuracion/RestriccionesPremiumScreen.tsx` | Ninguno |
| **AN-19** | Andrea Travola | `EliminarCuenta` | `src/screens/configuracion/EliminarCuentaScreen.tsx` | Ninguno |

---

## 4. Ejemplos de Uso del Contrato

### A. Tipar los Props de una Pantalla
Cada archivo de pantalla recibe `navigation` y `route` fuertemente tipados a través de los helpers de `src/navigation/types`:

```tsx
import React from 'react';
import { View, Text } from 'react-native';
import type { HomeScreenProps } from '../navigation/types';

export default function SuscripcionDetalleScreen({
  route,
  navigation,
}: HomeScreenProps<'SuscripcionDetalle'>) {
  // route.params.id está garantizado como string por TypeScript
  const { id } = route.params;

  return (
    <View>
      <Text>Detalle: {id}</Text>
    </View>
  );
}
```

### B. Navegar entre Pantallas
Se puede usar el prop `navigation` o el hook `useNavigation()`:

```tsx
import { useNavigation } from '@react-navigation/native';

function MiBoton() {
  const navigation = useNavigation();

  // Navegar a otra pantalla del mismo stack
  navigation.navigate('SuscripcionDetalle', { id: 'susc-123' });

  // Volver atrás en el stack
  if (navigation.canGoBack()) {
    navigation.goBack();
  }
}
```

### C. Cambiar entre Tabs Principales
Para cambiar de pestaña programáticamente:

```tsx
navigation.navigate('App', {
  screen: 'PanelTab',
  params: { screen: 'Informes' },
});
```

### D. Gestión de Sesión (Login / Logout)
La app conmuta de forma automática entre el flujo público (`AuthNavigator`) y el privado (`AppTabNavigator`) según el estado de `AuthContext`:

```tsx
import { useAuth } from '../context/AuthContext';

function HeaderUsuario() {
  const { usuario, cerrarSesion } = useAuth();

  const handleLogout = async () => {
    // Revoca sesión en el backend y limpia tokens locales en shared
    await cerrarSesion();
    // La app vuelve inmediatamente al flujo Login sin necesidad de navigate()
  };
}
```
