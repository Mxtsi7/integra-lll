# S3-MX-03/04 — Estadísticas de uso Android y permiso especial

## Estado

Implementación local del módulo nativo, lectura agregada del sistema y pantalla para consultar/abrir el permiso. Falta integrar una fuente de consentimiento vigente, compilar e instalar una development build en Android y comprobar concesión, denegación y revocación en dispositivo. No hay captura activa desde la pantalla.

## Inicio y requisitos

La lectura se inicia únicamente si el cliente entrega una sesión identificable, el control anfitrión confirma consentimiento vigente, Android concede `PACKAGE_USAGE_STATS` y el perfil del dispositivo está desbloqueado. El permiso de Android y el consentimiento de producto son controles separados. La comprobación de consentimiento predeterminada es `false`.

## Recorrido

1. `frontend/movil/src/screens/configuracion/ConfiguracionScreen.tsx` enlaza “Acceso de uso” a `UsoRecolectoresScreen`; la pantalla llama `crearControlPermisoUsoAndroid` y verifica `tienePermiso()` al abrir y al volver de Ajustes mediante `AppState`.
2. `frontend/movil/modules/uso-android` es un módulo local Expo que autolinking descubre bajo `movil/modules`. `AndroidManifest.xml` declara `PACKAGE_USAGE_STATS`; no se solicita un permiso runtime inexistente.
3. `UsoAndroidModule.tienePermiso` consulta `AppOpsManager`. `abrirAjustes` abre `Settings.ACTION_USAGE_ACCESS_SETTINGS`; volver de Ajustes no equivale a concederlo.
4. `crearControlUsoAndroid.leer(inicioMs, finMs)` comprueba rango, identidad de sesión y consentimiento; comprueba permiso antes de consultar; después vuelve a comprobar sesión, consentimiento y permiso antes de entregar el resultado.
5. El módulo Kotlin verifica además el consentimiento recibido, permiso, usuario desbloqueado y resultado no nulo de `UsageStatsManager.queryUsageStats`. Devuelve agregados `paquete`/`duracionMs`. Android puede expandir los intervalos de consulta; son estadísticas agregadas, no eventos exactos ni tramos de actividad.

No existe endpoint de envío desde Android en esta tarea. La instalación móvil aún no transforma agregados en eventos HTTP ni almacena una cola local.

## Errores y pruebas

Denegación, revocación, sesión reemplazada, consentimiento retirado, módulo ausente y consulta no disponible no se convierten en uso cero. Las pruebas locales ejercitan el servicio con dobles y la pantalla con un módulo nativo simulado; autolinking confirma que Expo encuentra el módulo Kotlin.

Comprobado localmente: 6 pruebas dirigidas, typecheck móvil, autolinking Android y `git diff --check`. Vitest usa `test/expo-shim.ts` para sustituir APIs Expo nativas con dobles en jsdom. Pendiente: lint global, prebuild/Gradle, instalación y verificaciones en dispositivo/emulador; este entorno carece de Android SDK y dispositivo configurado.
