# Contrato de Integración y Uso — Preferencias de Notificación Móvil (SE-32)

**Responsable:** Sebastian Mena · **Tarjeta:** SE-32  
**Sprint:** Sprint 3 · **Tipo:** CÓDIGO · **Prioridad:** Should / P1  
**Dependencias validadas e integradas:**
- **AN-04:** Construir Configuración móvil (Andrea Travola) — extensión completada en `secciones.ts`, `ConfiguracionNavigator.tsx` y `ConfiguracionScreen.tsx`.
- **FE-21:** Leer y guardar preferencias de notificación (Felipe Orellana) — consumido mediante `@ojoalgasto/shared` (`GET` y `PATCH /api/preferencias-alertas/`).

---

## 1. Alcance y Comportamiento

1. **Equivalencia total con Web (CH-30 / FE-21):**
   - **Canales (`Por dónde`):**
     - `por_email`: "Por correo" / "A la dirección de tu cuenta."
     - `por_push`: "Notificaciones push" / "En tu teléfono." (con control de permisos del dispositivo y `canales_disponibles`).
     - `en_la_app`: "Dentro de la app" / "En tus alertas de Ojo al Gasto."
     - Si un canal no está en `canales_disponibles`: *"Todavía no lo enviamos. Si lo activas, queda guardado para cuando esté listo."*
     - Si los 3 canales están apagados: *"Con todos los canales apagados no te llega ningún aviso."*
   - **Tipos de avisos (`De qué`):**
     - `avisar_proximo_cobro`: "Antes de cada cobro" / `${dias} días antes del cobro.` (o `1 día antes...`), leyendo `dias_anticipacion` del servidor (sin hardcodear).
     - `avisar_fin_prueba`: "Cuando termina una prueba gratis" / "Antes de que empiece a cobrar."
     - `avisar_alza_tarifa`: "Alza de tarifa" / "Cuando una suscripción sube de precio."
     - `avisar_doble_cobro`: "Posible doble cobro" / "Cuando parece que te cobraron dos veces lo mismo."
     - `avisar_presupuesto_excedido`: "Presupuesto excedido" / "Cuando el gasto del mes supera tu presupuesto."

2. **Manejo de permisos del dispositivo separado de la preferencia persistida:**
   - **Preferencia persistida (Backend):** Booleano `por_push` que viaja en el PATCH y persiste a nivel de cuenta.
   - **Permiso del dispositivo (Nativo/SO - Expo 57):** `EstadoPermisoDispositivo = 'concedido' | 'denegado' | 'no_determinado' | 'no_disponible'`.
   - **Adaptador Nativo (`AdaptadorNativoExpo`):** Consulta verazmente el sistema operativo mediante `getPermissionsAsync` / `requestPermissionsAsync` de Expo Notifications, y mediante `PermissionsAndroid` (`POST_NOTIFICATIONS`) para Android nativo (Android 13+ / API 33+ y versiones previas). Si ninguna API nativa está disponible, devuelve `'no_disponible'` de forma veraz, sin dobles en memoria ni concesiones automáticas ficticias.
   - **Regla crítica de negocio:** Si el permiso del dispositivo está `denegado` o `no_disponible`, el canal push **NUNCA** se presenta como canal habilitado en el dispositivo:
     - `canalPushHabilitadoEnDispositivo(preferenciaPersistida, estadoPermiso)` devuelve `false`.
     - La interfaz muestra explícitamente:
       `Estado push en este dispositivo: Inhabilitado (permiso denegado en dispositivo)` (o `No disponible en este dispositivo`).
     - Muestra un badge destacado: `Canal no habilitado en dispositivo` o `No disponible en este dispositivo`.
     - Si está denegado, ofrece un botón para **Abrir ajustes del dispositivo** (`Linking.openSettings()`).
     - Si está indeterminado (`no_determinado`), ofrece el botón **Permitir notificaciones en este dispositivo** (`btn-solicitar-permiso`) además de solicitarlo al encender el toggle.
     - Al volver de ajustes del sistema operativo (evento `AppState` `'active'`), el estado del permiso se reevalúa en caliente de forma veraz.
     - Si el usuario lo deniega, el canal queda inmediatamente inhabilitado en el dispositivo.

3. **Edición, Borrador y Guardado Selectivo (PATCH):**
   - La edición de toggles modifica un estado de borrador local (`editadas`).
   - El estado indica claramente: *"Tienes cambios sin guardar."* o *"Guardado · <fecha>"*.
   - Botón **Descartar**: revierte el borrador al último estado confirmado por el backend sin enviar peticiones.
   - Botón **Guardar cambios**: envía únicamente las claves que difieren entre lo guardado y lo editado (`cambiosDePreferencias`).
   - En caso de fallo de red o error de validación (400), los cambios editados se conservan en pantalla para que el usuario pueda reintentar sin perder su configuración.
   - Aislamiento de sesión: si la sesión cambia en `AuthContext`, se descarta cualquier borrador obsoleto y se recargan las preferencias de la nueva cuenta.

---

## 2. Puntos de Extensión e Integración

### Árbol de Navegación de Configuración (AN-04)
```
ConfiguracionScreen (AN-04)
 └── Sección 'Preferencias'
      ├── Centro de Alertas (AN-10) [testID: 'go-alertas']
      └── Preferencias de notificación (SE-32) [testID: 'pref-notificaciones']
           └── Navega a: PreferenciasNotificacionScreen
```

### Arquitectura Limpia (Clean Architecture)
El módulo se encuentra estructurado en capas estrictamente desacopladas:

1. **Capa de Dominio (`domain/`):**
   - Tipos e interfaces de dominio: `PreferenciasAlertas`, `PreferenciasEditables`, `EstadoPermisoDispositivo`.
   - Reglas de dominio puras:
     - `canalPushHabilitadoEnDispositivo(preferenciaPersistida, estadoPermiso)`
     - `formatearDiasAnticipacion(dias)`
     - `tieneCanalHabilitado(porEmail, porPush, enLaApp)`
   - Contratos de abstracción (puertos): `IPreferenciasRepository` e `IPermisosDispositivoGateway`.

2. **Capa de Datos e Infraestructura (`data/` y `services/`):**
   - `ApiPreferenciasRepository`: implementación de repositorio que consume `GET` y `PATCH` de `@ojoalgasto/shared`.
   - `permisosNotificaciones.ts`: implementación de gateway para consulta y solicitud de permisos nativos del SO.

3. **Capa de Aplicación (`usePreferenciasNotificaciones.ts`):**
   - Hook de casos de uso / ViewModel desacoplado de la UI: gestiona carga reactiva, borrador local, cálculo de diffs, solicitud de permisos, persistencia selectiva y aislamiento de sesión.

4. **Capa de Presentación (`notificaciones.styles.ts`, `FilaInterruptor.tsx`, `PreferenciasNotificacionesContenido.tsx`, `PreferenciasNotificacionScreen.tsx`):**
   - Estilos unificados con la pantalla principal (`HomeScreen.styles.ts` y `SuscripcionDetalleScreen.styles.ts`): fondo `#0f172a`, tarjetas `#1e293b` con bordes `#334155`, títulos `#ffffff`, acentos `#38bdf8`, y espaciados estandarizados.
   - Componentes presentacionales puros desacoplados de la red mediante inyección de dependencias.

### Rutas y Componentes
| Capa | Archivo | Responsabilidad |
|---|---|---|
| Dominio | `src/screens/components/notificaciones/domain/preferencias.types.ts` | Entidades, reglas de negocio y contratos de repositorio / gateway. |
| Datos | `src/screens/components/notificaciones/data/preferenciasRepository.ts` | Repositorio que consume la API REST de `@ojoalgasto/shared`. |
| Servicios | `src/services/permisosNotificaciones.ts` | Adaptador y control de permisos nativos del dispositivo. |
| Aplicación | `src/screens/components/notificaciones/usePreferenciasNotificaciones.ts` | Hook de casos de uso (ViewModel) con gestión de estado y borrador. |
| Presentación | `src/screens/components/notificaciones/notificaciones.styles.ts` | Estilos consistentes con `HomeScreen.styles.ts` (tema slate oscuro). |
| Presentación | `src/screens/components/notificaciones/FilaInterruptor.tsx` | Fila accesible con etiquetas, alertas, badges y `<Switch>`. |
| Presentación | `src/screens/components/notificaciones/PreferenciasNotificacionesContenido.tsx` | Contenido interactivo conectado a la capa de aplicación. |
| Presentación | `src/screens/configuracion/PreferenciasNotificacionScreen.tsx` | Pantalla del stack con `SafeAreaView`, `header` y botón "Volver a Configuración". |
| Navegación | `src/screens/configuracion/secciones.ts` | Configuración de ítems y destinos del stack móvil. |

---

## 3. Ejemplo de Uso

```tsx
import React from 'react';
import { PreferenciasNotificacionesContenido } from './src/screens/components/notificaciones/PreferenciasNotificacionesContenido';
import { crearControlPermisosNotificaciones } from './src/services/permisosNotificaciones';

export function MiPantallaNotificaciones() {
  return (
    <PreferenciasNotificacionesContenido
      controlPermisos={crearControlPermisosNotificaciones()}
      onExitoGuardar={() => {
        console.log('Preferencias guardadas exitosamente');
      }}
    />
  );
}
```

---

## 4. Criterios de Aceptación Verificados

- [x] **Valores coinciden con backend y web:** Consumo de `GET` y `PATCH /api/preferencias-alertas/` usando `@ojoalgasto/shared`, mismos canales, mismos tipos de alertas y `dias_anticipacion` dinámico.
- [x] **Adaptador veraz y permisos de SO (Expo 57):** Implementado `AdaptadorNativoExpo` conectando `getPermissionsAsync` y `requestPermissionsAsync` reales. Si el módulo no está disponible o el permiso está denegado, nunca concede automáticamente ni presenta el canal como habilitado.
- [x] **Denegar permiso push no se presenta como canal habilitado en dispositivo:** Si el permiso del SO es `denegado` o `no_disponible`, el canal push se presenta explícitamente como inhabilitado con alerta y badge, impidiendo falsos positivos, y ofrece botón para abrir ajustes del sistema (`Linking.openSettings()`).
- [x] **Reevaluación en caliente al volver de Ajustes:** Manejo reactivo de `AppState` `'active'` para refrescar el permiso inmediatamente al regresar de los ajustes del sistema.
- [x] **Evidencia y pruebas automatizadas:** Suite completa de 25 pruebas unitarias y de integración en `src/screens/components/notificaciones/notificaciones.test.tsx`, prueba de navegación en `PreferenciasNotificacionScreen.test.tsx` y validación de secciones en `secciones.test.ts`.
