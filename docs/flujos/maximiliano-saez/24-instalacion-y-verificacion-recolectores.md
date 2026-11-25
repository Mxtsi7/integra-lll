# S3-MX-24 · Instalación y verificación de los recolectores

Esta guía reúne los pasos disponibles de instalación y deja una matriz para
registrar las pruebas de MX-22 y MX-23 sobre el mismo commit. El informe de
resultados y la retrospectiva de campo quedan pendientes de esas pruebas.

## Android

1. Instala JDK y Android SDK, activa depuración USB y comprueba que el
   teléfono aparezca autorizado en `adb devices`. Prepara la URL de API LAN
   según el [README móvil](../../../frontend/movil/README.md).
2. Ejecuta `npm ci` en `frontend/`, luego `npx expo run:android --device`
   desde `frontend/movil/` para compilar e instalar la app con el módulo
   nativo local. Usa la compilación de desarrollo con el módulo Kotlin.
3. En la app, abre Configuración → Acceso de uso. Comprueba primero
   denegación, luego concede acceso desde Ajustes y vuelve a la app.
   Retira el permiso desde Ajustes y confirma que el estado se actualice.
4. Registra modelo, versión Android y resultado de cada escenario. El
   [flujo de permisos](03-04-android-permisos.md) enumera estados y límites
   del módulo. La lectura real de tramos y la fuente de consentimiento
   vigente condicionan la validación de captura.

## Chrome y Edge

1. En `chrome://extensions` o `edge://extensions`, activa Modo desarrollador
   y carga `frontend/extension/` descomprimida.
2. Abre el panel sin conceder permisos. Selecciona un host HTTPS exacto,
   revisa el texto de consentimiento y concede su permiso al pulsar Autorizar.
3. Abre una ventana autorizada y otra con un host no autorizado. Alterna
   A → B → A, cambia de aplicación, provoca inactividad y revoca el permiso.
   Compara estados y tramos con el [recorrido de extensión](../../../frontend/extension/README.md).
4. Registra navegador, versión, permisos, tiempos, tramos y resultado. Usa
   una cuenta y dominios de prueba y omite URLs privadas, tokens y contenido.

## Pruebas integradas pendientes

| Escenario | Resultado esperado | Dependencia |
| --- | --- | --- |
| Android autorizado | Tramos reales del paquete permitido y exclusión del resto | MX-05 y consentimiento vigente |
| Android y extensión sin conexión | El pendiente sobrevive al reinicio y el mismo ID llega una vez al receptor | MX-16, MX-17, MX-18 |
| Cobertura tras reconexión | La hora de sincronización avanza solo con un acuse válido | MX-19 |
| Pausa y revocación | Se detiene captura y envío. Reanudar excluye el período pausado | MX-20, MX-21 |

El [contrato v1](../../contratos/uso-recolectores-v1.md) define el receptor y
sus acuses. La [PR #181](https://github.com/Mxtsi7/integra-lll/pull/181)
contiene la entrega de permisos Android y la
[PR #149](https://github.com/Mxtsi7/integra-lll/pull/149) la extensión.
Las pruebas automatizadas de esas entregas sirven para repetir la lógica
de forma controlada. Adjunta a MX-22 y MX-23 los resultados del dispositivo
y navegador, con fecha, SHA y pasos, y usa esos hallazgos para completar la
retrospectiva de esta guía.
